import { NotFoundException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { QueueService } from '../../infra/queue/queue.service';
import type { BackupStatusService } from './backup-status.service';
import { MetricsTokenGuard } from './metrics.controller';
import { OpsMetricsService } from './ops-metrics.service';

const T1 = 'm'.repeat(40);

function ctx(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}
const guard = (env: Partial<Env>) => new MetricsTokenGuard(env as Env);

describe('MetricsTokenGuard', () => {
  it('does not exist (404) without a token', () => {
    expect(() => guard({}).canActivate(ctx(`Bearer ${T1}`))).toThrow(NotFoundException);
  });

  it('is 401 without or with a wrong token, and passes the right one', () => {
    const g = guard({ METRICS_TOKEN: T1 });
    expect(() => g.canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => g.canActivate(ctx('Bearer nope'))).toThrow(UnauthorizedException);
    expect(() => g.canActivate(ctx(`Basic ${T1}`))).toThrow(UnauthorizedException);
    expect(g.canActivate(ctx(`Bearer ${T1}`))).toBe(true);
  });

  it('a token shared with another service API is treated as unset', () => {
    expect(() =>
      guard({ METRICS_TOKEN: T1, INTEGRATION_TOKEN: T1 }).canActivate(ctx(`Bearer ${T1}`)),
    ).toThrow(NotFoundException);
    expect(() =>
      guard({ METRICS_TOKEN: T1, RESEARCHER_INTEGRATION_TOKEN: T1 }).canActivate(
        ctx(`Bearer ${T1}`),
      ),
    ).toThrow(NotFoundException);
    expect(
      guard({ METRICS_TOKEN: T1, INTEGRATION_TOKEN: 'i'.repeat(40) }).canActivate(
        ctx(`Bearer ${T1}`),
      ),
    ).toBe(true);
  });
});

function service(opts: { driver?: 'bullmq' | 'inline'; workers?: number } = {}) {
  const now = Date.now();
  const prisma = {
    aiJob: {
      count: vi.fn(async (a: { where: { status: string } }) =>
        a.where.status === 'QUEUED' ? 4 : 1,
      ),
      findFirst: vi.fn(async () => ({ createdAt: new Date(now - 125_000) })),
      groupBy: vi.fn(async (a: { by: string[] }) =>
        a.by.length === 2
          ? [
              { type: 'GENERATE_CONTENT', status: 'QUEUED', _count: { _all: 3 } },
              { type: 'IDEATE', status: 'RUNNING', _count: { _all: 1 } },
            ]
          : [
              { status: 'SUCCEEDED', _count: { _all: 40 } },
              { status: 'FAILED', _count: { _all: 2 } },
            ],
      ),
      aggregate: vi.fn(async () => ({
        _sum: { costUsd: 1.5, inputTokens: 1000, outputTokens: 500 },
      })),
      findMany: vi.fn(async () =>
        [10, 20, 30, 40, 100].map((s) => ({
          startedAt: new Date(now - 1_000_000),
          finishedAt: new Date(now - 1_000_000 + s * 1000),
        })),
      ),
    },
    appError: { count: vi.fn(async () => 3) },
  };
  const queue = { liveWorkers: vi.fn(async () => opts.workers ?? 1) };
  const backups = {
    summary: async () => ({
      restoreCheck: 'ok' as const,
      lastRestoreVerifiedAt: new Date(now - 3600_000).toISOString(),
    }),
  };
  const svc = new OpsMetricsService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
    backups as unknown as BackupStatusService,
    { QUEUE_DRIVER: opts.driver ?? 'bullmq' } as Env,
  );
  return { svc, prisma, queue };
}

describe('OpsMetricsService.prometheus', () => {
  it('reports queue depth and age, jobs by type, the 24-hour window, cost and the restore check', async () => {
    const text = await service().svc.prometheus();
    expect(text).toContain('contenter_up 1');
    expect(text).toContain('contenter_queue_driver{driver="bullmq"} 1');
    expect(text).toContain('contenter_workers_alive 1');
    expect(text).toContain('contenter_worker_ok 1');
    expect(text).toContain('contenter_ai_jobs_waiting 4');
    expect(text).toMatch(/contenter_ai_jobs_oldest_waiting_seconds 12[4-6]/);
    expect(text).toContain('contenter_ai_jobs_stuck 1');
    expect(text).toContain('contenter_ai_jobs_pending{type="GENERATE_CONTENT",status="QUEUED"} 3');
    expect(text).toContain('contenter_ai_jobs_finished_window{status="FAILED",window="24h"} 2');
    expect(text).toContain('contenter_ai_job_duration_seconds{quantile="0.5",window="24h"} 30');
    expect(text).toContain('contenter_ai_job_duration_seconds{quantile="0.9",window="24h"} 100');
    expect(text).toContain('contenter_ai_cost_usd_window{window="24h"} 1.5');
    expect(text).toContain('contenter_ai_tokens_window{type="input",window="24h"} 1000');
    expect(text).toContain('contenter_app_errors_open_window{window="24h"} 3');
    expect(text).toContain('contenter_restore_check_ok 1');
    expect(text).toMatch(/contenter_restore_check_age_seconds 36\d\d/);
  });

  it('carries no identifiers: only job types, statuses and fixed windows', async () => {
    const text = await service().svc.prometheus();
    const labels = [...text.matchAll(/(\w+)="/g)].map((m) => m[1]);
    expect(new Set(labels)).toEqual(new Set(['type', 'status', 'window', 'quantile', 'driver']));
    expect(text).not.toMatch(/user|business|topic|email|@/i);
  });

  it('with the inline queue there is no worker series', async () => {
    const text = await service({ driver: 'inline' }).svc.prometheus();
    expect(text).not.toContain('contenter_workers_alive');
    expect(text).not.toContain('contenter_worker_ok');
    expect(text).toContain('contenter_queue_driver{driver="inline"} 1');
  });

  it('a dead worker shows as 0', async () => {
    const text = await service({ workers: 0 }).svc.prometheus();
    expect(text).toContain('contenter_worker_ok 0');
  });
});

describe('OpsMetricsService.health', () => {
  it('turns the numbers into the verdict, and skips the database when it is down', async () => {
    const ok = await service().svc.health(true, true);
    expect(ok).toMatchObject({ status: 'ok', worker: 'ok', queue: { waiting: 4, stuck: 1 } });
    const down = service();
    const r = await down.svc.health(false, true);
    expect(r.status).toBe('degraded');
    expect(down.prisma.aiJob.count).not.toHaveBeenCalled();
  });
});
