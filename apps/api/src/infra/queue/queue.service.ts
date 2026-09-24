import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../../config/env';

export const AI_QUEUE = 'ai-jobs';
export const MAX_ATTEMPTS = 3;

export interface AttemptInfo {
  attempt: number; // 1-based
  maxAttempts: number;
}

/** Throw from a handler to fail immediately without retries. */
export class PermanentJobError extends Error {}

export type JobHandler = (jobId: string, attempt: AttemptInfo) => Promise<void>;

/**
 * Queue abstraction with two drivers:
 *  - `bullmq`: durable Redis queue; workers scale horizontally (APP_ROLE=worker).
 *  - `inline`: in-process execution for tests and Redis-less environments.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;
  private handler?: JobHandler;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.QUEUE_DRIVER === 'bullmq') {
      this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.queue = new Queue(AI_QUEUE, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
    }
  }

  get isWorker() {
    return this.env.APP_ROLE === 'worker' || this.env.APP_ROLE === 'all';
  }

  async enqueue(jobId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add('run', { jobId }, { jobId });
      return;
    }
    setImmediate(() => void this.runInline(jobId));
  }

  /** Registers the consumer. Only starts a BullMQ worker on worker/all roles. */
  registerHandler(handler: JobHandler) {
    this.handler = handler;
    if (!this.isWorker || !this.connection) return;
    this.worker = new Worker(
      AI_QUEUE,
      async (job: Job<{ jobId: string }>) => {
        try {
          await handler(job.data.jobId, {
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts ?? MAX_ATTEMPTS,
          });
        } catch (err) {
          if (err instanceof PermanentJobError) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
      { connection: this.connection.duplicate(), concurrency: this.env.WORKER_CONCURRENCY },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`job ${job?.data.jobId} failed: ${err.message}`),
    );
    this.logger.log(`AI worker started (concurrency ${this.env.WORKER_CONCURRENCY})`);
  }

  async stats() {
    if (!this.queue) return { driver: 'inline' as const };
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return { driver: 'bullmq' as const, ...counts };
  }

  async ping(): Promise<boolean> {
    if (!this.connection) return true;
    try {
      return (await this.connection.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  private async runInline(jobId: string) {
    if (!this.handler) {
      this.logger.error(`No handler registered; job ${jobId} dropped`);
      return;
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.handler(jobId, { attempt, maxAttempts: MAX_ATTEMPTS });
        return;
      } catch (err) {
        if (err instanceof PermanentJobError || attempt === MAX_ATTEMPTS) return;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
