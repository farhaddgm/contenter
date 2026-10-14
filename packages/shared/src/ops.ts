/**
 * The result of the weekly backup restore check (`scripts/backup.sh verify`, docs/13-operations.md
 * section 8). The script writes it to `verify-status.json` and hands the same JSON to the API
 * (`apps/api/src/cli/record-backup-verify.ts`), which stores it and warns the admins when it failed.
 */
import { z } from 'zod';

export const BackupVerifyStatusSchema = z.object({
  ok: z.boolean(),
  /** Server local time, "YYYY-MM-DD HH:MM:SS" (written by the script). */
  checkedAt: z.string().min(1).max(40),
  source: z.enum(['local', 'offsite']),
  backup: z.string().max(200),
  backupAgeHours: z.number().int().min(0).max(1_000_000),
  tables: z.number().int().min(0).max(100_000),
  migrations: z.number().int().min(0).max(100_000),
  uploadFiles: z.number().int().min(0).max(100_000_000),
  /** Row counts of the key tables, by table name. */
  rows: z.record(z.string().max(60), z.number().int().min(0)),
  problems: z.array(z.string().max(500)).max(50),
  warnings: z.array(z.string().max(500)).max(50),
});
export type BackupVerifyStatus = z.infer<typeof BackupVerifyStatusSchema>;

/** What the API keeps and what `GET /api/health` shows of it. */
export interface BackupVerifyRecord {
  /** The latest check and its verdict. */
  last: BackupVerifyStatus;
  /** When the API received it (ISO). */
  receivedAt: string;
  /** The last time a check passed (ISO), kept across later failures. */
  lastOkAt: string | null;
}

// ─────────────────────────── deep health (docs/54-ops-metrics.md) ───────────────────────────

/** A queued job older than this means the queue is not moving (seconds). */
export const QUEUE_STALLED_SECONDS = 15 * 60;
/** A job `RUNNING` for longer than this counts as stuck (seconds). */
export const JOB_STUCK_SECONDS = 30 * 60;
/** The worker writes its heartbeat this often and it expires after the TTL (seconds). */
export const WORKER_HEARTBEAT_EVERY_SECONDS = 30;
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;
/**
 * A freshly started API is not called degraded for a missing worker during this time, so a deploy
 * that waits for `status: ok` (scripts/deploy.sh) is not failed by a worker that is still starting.
 */
export const WORKER_STARTUP_GRACE_SECONDS = 180;

/** `ok` = a worker is alive · `down` = none · `na` = the inline queue has no separate worker. */
export type WorkerState = 'ok' | 'down' | 'na';

/** The public part of `GET /api/health` that the deep checks add (numbers and verdicts only). */
export interface DeepHealth {
  status: 'ok' | 'degraded';
  worker: WorkerState;
  queue: {
    /** Jobs waiting to start. */
    waiting: number;
    /** Age in seconds of the oldest waiting job; null when none waits. */
    oldestWaitingSeconds: number | null;
    /** Jobs running for longer than `JOB_STUCK_SECONDS`. */
    stuck: number;
  };
}
