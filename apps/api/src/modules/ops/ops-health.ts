/**
 * The deep health verdict and the Prometheus text of `/api/metrics` (docs/54-ops-metrics.md).
 * Pure functions: the service gathers the numbers, these decide and format. Metrics carry only a
 * fixed set of low-cardinality labels (job type, status, window, quantile, driver) — never a user,
 * a business or a project.
 */
import {
  QUEUE_STALLED_SECONDS,
  WORKER_STARTUP_GRACE_SECONDS,
  type DeepHealth,
  type WorkerState,
} from '@contenter/shared';

export interface HealthInput {
  db: boolean;
  redis: boolean;
  driver: 'bullmq' | 'inline';
  /** Live worker heartbeats (bullmq only). */
  workers: number;
  uptimeSeconds: number;
  waiting: number;
  oldestWaitingSeconds: number | null;
  stuck: number;
}

export function workerState(driver: HealthInput['driver'], workers: number): WorkerState {
  if (driver === 'inline') return 'na';
  return workers > 0 ? 'ok' : 'down';
}

/**
 * `degraded` when the database or Redis is unreachable, when no worker is alive (after the startup
 * grace) or when the oldest waiting job is older than `QUEUE_STALLED_SECONDS`. A stuck running job
 * is reported as a number only: one slow model call must not turn the whole service red.
 */
export function evaluateHealth(i: HealthInput): DeepHealth {
  const worker = workerState(i.driver, i.workers);
  const noWorker = worker === 'down' && i.uptimeSeconds >= WORKER_STARTUP_GRACE_SECONDS;
  const stalled = i.oldestWaitingSeconds !== null && i.oldestWaitingSeconds > QUEUE_STALLED_SECONDS;
  return {
    status: i.db && i.redis && !noWorker && !stalled ? 'ok' : 'degraded',
    worker,
    queue: {
      waiting: i.waiting,
      oldestWaitingSeconds: i.oldestWaitingSeconds,
      stuck: i.stuck,
    },
  };
}

// ─────────────────────────────── Prometheus text ───────────────────────────────

/** The only label names a metric may use. */
export const ALLOWED_LABELS = ['type', 'status', 'window', 'quantile', 'driver'] as const;
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

export interface PromSample {
  labels?: Partial<Record<(typeof ALLOWED_LABELS)[number], string>>;
  value: number;
}

export interface PromMetric {
  name: string;
  help: string;
  samples: PromSample[];
}

const escapeLabel = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

/**
 * Prometheus exposition format (text 0.0.4), every metric a gauge. A metric without a finite
 * sample is left out, a label outside `ALLOWED_LABELS` or a bad name throws (a programming error).
 */
export function renderPrometheus(metrics: readonly PromMetric[]): string {
  const out: string[] = [];
  for (const m of metrics) {
    if (!NAME_RE.test(m.name)) throw new Error(`Invalid metric name: ${m.name}`);
    const lines: string[] = [];
    for (const s of m.samples) {
      if (!Number.isFinite(s.value)) continue;
      const labels = Object.entries(s.labels ?? {});
      for (const [k] of labels) {
        if (!(ALLOWED_LABELS as readonly string[]).includes(k)) {
          throw new Error(`Label "${k}" is not allowed on ${m.name} (cardinality)`);
        }
      }
      const text = labels.length
        ? `{${labels.map(([k, v]) => `${k}="${escapeLabel(String(v))}"`).join(',')}}`
        : '';
      lines.push(
        `${m.name}${text} ${Number.isInteger(s.value) ? s.value : Number(s.value.toFixed(6))}`,
      );
    }
    if (!lines.length) continue;
    out.push(`# HELP ${m.name} ${m.help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}`);
    out.push(`# TYPE ${m.name} gauge`);
    out.push(...lines);
  }
  return `${out.join('\n')}\n`;
}
