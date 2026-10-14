import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { JOB_STUCK_SECONDS, type DeepHealth } from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { percentile } from '../dashboard/productivity';
import { BackupStatusService } from './backup-status.service';
import { evaluateHealth, renderPrometheus, workerState, type PromMetric } from './ops-health';

const WINDOW_MS = 24 * 3_600_000;
/** Durations are read from at most this many finished jobs of the window. */
const DURATION_SAMPLES = 5000;

/**
 * Operational numbers for `/api/health` and `/api/metrics` (docs/54-ops-metrics.md). They come from
 * the job table (reliable with either queue driver) and the worker heartbeats in Redis. Only
 * counts, ages, durations and cost; no job input, no names.
 */
@Injectable()
export class OpsMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly backups: BackupStatusService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async queueNumbers(now: Date) {
    const stuckBefore = new Date(now.getTime() - JOB_STUCK_SECONDS * 1000);
    const [waiting, oldest, stuck] = await Promise.all([
      this.prisma.aiJob.count({ where: { status: 'QUEUED' } }),
      this.prisma.aiJob.findFirst({
        where: { status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.aiJob.count({ where: { status: 'RUNNING', startedAt: { lt: stuckBefore } } }),
    ]);
    return {
      waiting,
      oldestWaitingSeconds: oldest
        ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 1000))
        : null,
      stuck,
    };
  }

  /** The verdict of `GET /api/health`; `db`/`redis` come from the caller's own pings. */
  async health(db: boolean, redis: boolean): Promise<DeepHealth> {
    const driver = this.env.QUEUE_DRIVER;
    const [workers, q] = await Promise.all([
      driver === 'bullmq' ? this.queue.liveWorkers() : Promise.resolve(0),
      db
        ? this.queueNumbers(new Date()).catch(() => ({
            waiting: 0,
            oldestWaitingSeconds: null,
            stuck: 0,
          }))
        : { waiting: 0, oldestWaitingSeconds: null, stuck: 0 },
    ]);
    return evaluateHealth({ db, redis, driver, workers, uptimeSeconds: process.uptime(), ...q });
  }

  /** Prometheus text for `GET /api/metrics`. */
  async prometheus(): Promise<string> {
    const now = new Date();
    const since = new Date(now.getTime() - WINDOW_MS);
    const driver = this.env.QUEUE_DRIVER;
    const [q, workers, pending, finished, sums, durations, openErrors, backup] = await Promise.all([
      this.queueNumbers(now),
      driver === 'bullmq' ? this.queue.liveWorkers() : Promise.resolve(0),
      this.prisma.aiJob.groupBy({
        by: ['type', 'status'],
        where: { status: { in: ['QUEUED', 'RUNNING'] } },
        _count: { _all: true },
      }),
      this.prisma.aiJob.groupBy({
        by: ['status'],
        where: { finishedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.aiJob.aggregate({
        where: { finishedAt: { gte: since } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      }),
      this.prisma.aiJob.findMany({
        where: { status: 'SUCCEEDED', finishedAt: { gte: since }, startedAt: { not: null } },
        orderBy: { finishedAt: 'desc' },
        take: DURATION_SAMPLES,
        select: { startedAt: true, finishedAt: true },
      }),
      this.prisma.appError.count({
        where: { status: { in: ['NEW', 'SEEN'] }, lastSeenAt: { gte: since } },
      }),
      this.backups.summary().catch(() => null),
    ]);
    const seconds = durations
      .map((d) => (d.finishedAt!.getTime() - d.startedAt!.getTime()) / 1000)
      .filter((s) => s >= 0)
      .sort((a, b) => a - b);
    const w = { window: '24h' } as const;
    const metrics: PromMetric[] = [
      { name: 'contenter_up', help: 'The API answers', samples: [{ value: 1 }] },
      {
        name: 'contenter_queue_driver',
        help: 'The queue driver in use (value 1)',
        samples: [{ labels: { driver }, value: 1 }],
      },
      {
        name: 'contenter_workers_alive',
        help: 'Worker processes with a live heartbeat (bullmq only)',
        samples: driver === 'bullmq' ? [{ value: workers }] : [],
      },
      {
        name: 'contenter_worker_ok',
        help: '1 if a worker is alive, 0 if none; absent for the inline queue',
        samples: workerState(driver, workers) === 'na' ? [] : [{ value: workers > 0 ? 1 : 0 }],
      },
      {
        name: 'contenter_ai_jobs_waiting',
        help: 'AI jobs waiting to start',
        samples: [{ value: q.waiting }],
      },
      {
        name: 'contenter_ai_jobs_oldest_waiting_seconds',
        help: 'Age of the oldest waiting AI job',
        samples:
          q.oldestWaitingSeconds === null ? [{ value: 0 }] : [{ value: q.oldestWaitingSeconds }],
      },
      {
        name: 'contenter_ai_jobs_stuck',
        help: `AI jobs running for more than ${JOB_STUCK_SECONDS} seconds`,
        samples: [{ value: q.stuck }],
      },
      {
        name: 'contenter_ai_jobs_pending',
        help: 'Waiting and running AI jobs by job type and status',
        samples: pending.map((p) => ({
          labels: { type: p.type, status: p.status },
          value: p._count._all,
        })),
      },
      {
        name: 'contenter_ai_jobs_finished_window',
        help: 'AI jobs that finished in the last 24 hours, by status',
        samples: finished.map((f) => ({
          labels: { status: f.status, ...w },
          value: f._count._all,
        })),
      },
      {
        name: 'contenter_ai_job_duration_seconds',
        help: 'Run time of succeeded AI jobs in the last 24 hours, by quantile',
        samples: seconds.length
          ? [0.5, 0.9, 0.99].map((p) => ({
              labels: { quantile: String(p), ...w },
              value: Math.round(percentile(seconds, p)! * 100) / 100,
            }))
          : [],
      },
      {
        name: 'contenter_ai_cost_usd_window',
        help: 'AI cost in USD of jobs finished in the last 24 hours',
        samples: [{ labels: w, value: sums._sum.costUsd ?? 0 }],
      },
      {
        name: 'contenter_ai_tokens_window',
        help: 'AI tokens of jobs finished in the last 24 hours, by direction',
        samples: [
          { labels: { type: 'input', ...w } as never, value: sums._sum.inputTokens ?? 0 },
          { labels: { type: 'output', ...w } as never, value: sums._sum.outputTokens ?? 0 },
        ],
      },
      {
        name: 'contenter_app_errors_open_window',
        help: 'Open recorded error groups seen in the last 24 hours',
        samples: [{ labels: w, value: openErrors }],
      },
      {
        name: 'contenter_restore_check_ok',
        help: '1 if the last weekly restore check passed, 0 if it failed; absent if never reported',
        samples:
          !backup || backup.restoreCheck === 'never'
            ? []
            : [{ value: backup.restoreCheck === 'ok' ? 1 : 0 }],
      },
      {
        name: 'contenter_restore_check_age_seconds',
        help: 'Seconds since the last passing restore check',
        samples: backup?.lastRestoreVerifiedAt
          ? [
              {
                value: Math.max(
                  0,
                  Math.round(
                    (now.getTime() - new Date(backup.lastRestoreVerifiedAt).getTime()) / 1000,
                  ),
                ),
              },
            ]
          : [],
      },
    ];
    return renderPrometheus(metrics);
  }
}
