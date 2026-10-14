import { describe, expect, it } from 'vitest';
import {
  JOB_STUCK_SECONDS,
  QUEUE_STALLED_SECONDS,
  WORKER_STARTUP_GRACE_SECONDS,
} from '@contenter/shared';
import { evaluateHealth, renderPrometheus, workerState, type HealthInput } from './ops-health';

const base: HealthInput = {
  db: true,
  redis: true,
  driver: 'bullmq',
  workers: 1,
  uptimeSeconds: 10_000,
  waiting: 0,
  oldestWaitingSeconds: null,
  stuck: 0,
};

describe('evaluateHealth', () => {
  it('is ok with a database, Redis and a live worker', () => {
    expect(evaluateHealth(base)).toEqual({
      status: 'ok',
      worker: 'ok',
      queue: { waiting: 0, oldestWaitingSeconds: null, stuck: 0 },
    });
  });

  it('is degraded without a worker once the startup grace has passed, ok during it', () => {
    const down = { ...base, workers: 0 };
    expect(evaluateHealth(down).status).toBe('degraded');
    expect(evaluateHealth(down).worker).toBe('down');
    expect(
      evaluateHealth({ ...down, uptimeSeconds: WORKER_STARTUP_GRACE_SECONDS - 1 }).status,
    ).toBe('ok');
    expect(evaluateHealth({ ...down, uptimeSeconds: WORKER_STARTUP_GRACE_SECONDS }).status).toBe(
      'degraded',
    );
  });

  it('the grace is longer than the deploy script waits for "ok" (30 × 5 s)', () => {
    expect(WORKER_STARTUP_GRACE_SECONDS).toBeGreaterThan(150);
  });

  it('is degraded when the queue does not move, ok at the limit', () => {
    const at = { ...base, waiting: 3, oldestWaitingSeconds: QUEUE_STALLED_SECONDS };
    expect(evaluateHealth(at).status).toBe('ok');
    expect(evaluateHealth({ ...at, oldestWaitingSeconds: QUEUE_STALLED_SECONDS + 1 }).status).toBe(
      'degraded',
    );
  });

  it('a stuck running job is a number, not a red status', () => {
    const r = evaluateHealth({ ...base, stuck: 2 });
    expect(r.status).toBe('ok');
    expect(r.queue.stuck).toBe(2);
    expect(JOB_STUCK_SECONDS).toBeGreaterThan(0);
  });

  it('is degraded without the database or Redis', () => {
    expect(evaluateHealth({ ...base, db: false }).status).toBe('degraded');
    expect(evaluateHealth({ ...base, redis: false }).status).toBe('degraded');
  });

  it('the inline queue has no separate worker to miss', () => {
    expect(workerState('inline', 0)).toBe('na');
    const r = evaluateHealth({ ...base, driver: 'inline', workers: 0 });
    expect(r.worker).toBe('na');
    expect(r.status).toBe('ok');
  });
});

describe('renderPrometheus', () => {
  it('writes HELP, TYPE and samples with labels, integers plain and fractions rounded', () => {
    const text = renderPrometheus([
      { name: 'contenter_queue_waiting', help: 'Jobs waiting', samples: [{ value: 3 }] },
      {
        name: 'contenter_ai_jobs',
        help: 'Jobs by type and status',
        samples: [
          { labels: { type: 'GENERATE_CONTENT', status: 'QUEUED' }, value: 2 },
          { labels: { type: 'IDEATE', status: 'RUNNING' }, value: 1.23456789 },
        ],
      },
    ]);
    expect(text).toBe(
      [
        '# HELP contenter_queue_waiting Jobs waiting',
        '# TYPE contenter_queue_waiting gauge',
        'contenter_queue_waiting 3',
        '# HELP contenter_ai_jobs Jobs by type and status',
        '# TYPE contenter_ai_jobs gauge',
        'contenter_ai_jobs{type="GENERATE_CONTENT",status="QUEUED"} 2',
        'contenter_ai_jobs{type="IDEATE",status="RUNNING"} 1.234568',
        '',
      ].join('\n'),
    );
  });

  it('leaves out non-finite samples and a metric with none', () => {
    const text = renderPrometheus([
      { name: 'a_b', help: 'x', samples: [{ value: Number.NaN }, { value: Infinity }] },
      { name: 'c_d', help: 'y', samples: [{ value: Number.NaN }, { value: 4 }] },
    ]);
    expect(text).not.toContain('a_b');
    expect(text).toContain('c_d 4');
  });

  it('escapes label values', () => {
    const text = renderPrometheus([
      { name: 'm', help: 'h', samples: [{ labels: { status: 'a"b\\c\nd' }, value: 1 }] },
    ]);
    expect(text).toContain('m{status="a\\"b\\\\c\\nd"} 1');
  });

  it('refuses a label that could explode cardinality, and a bad name', () => {
    expect(() =>
      renderPrometheus([
        { name: 'm', help: 'h', samples: [{ labels: { userId: 'u1' } as never, value: 1 }] },
      ]),
    ).toThrow(/not allowed/);
    expect(() =>
      renderPrometheus([{ name: 'Bad-Name', help: 'h', samples: [{ value: 1 }] }]),
    ).toThrow(/Invalid metric name/);
  });

  it('an empty list is just a newline', () => {
    expect(renderPrometheus([])).toBe('\n');
  });
});
