import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, type AiJob } from '@prisma/client';
import { isEconomyTask, type AiJobStatus, type AiJobType, type PaginationQuery } from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PermanentJobError, QueueService, type AttemptInfo } from '../../infra/queue/queue.service';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { ErrorTrackerService } from '../smart/smart-core.services';
import { batchContext, JobDeferredError, type BatchContext } from './batch/batch-context';
import { BudgetService } from './budget.service';
import { estimateCostUsd } from './pricing';
import { NonRetryableAiError } from './provider/ai-provider';
import { AI_RUNNERS, type AiRunner } from './runners/runner';

export interface EnqueueArgs {
  type: AiJobType;
  targetType: string;
  targetId: string;
  topicId?: string | null;
  input?: Record<string, unknown>;
  userId?: string | null;
  /** Economy mode: the vendor's batch API, about half the price, an answer within 24 hours. */
  economy?: boolean;
}

const errorMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 4000);

@Injectable()
export class AiJobsService implements OnModuleInit {
  private readonly logger = new Logger(AiJobsService.name);
  private readonly runners: Map<AiJobType, AiRunner>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly errors: ErrorTrackerService,
    private readonly budget: BudgetService,
    @Inject(AI_RUNNERS) runners: AiRunner[],
  ) {
    this.runners = new Map(runners.map((r) => [r.type, r]));
  }

  onModuleInit() {
    this.queue.registerHandler((jobId, attempt) => this.process(jobId, attempt));
  }

  /** Records the job and hands it to the queue. The HTTP layer returns immediately. */
  async enqueue(args: EnqueueArgs): Promise<AiJob> {
    const job = await this.prisma.aiJob.create({
      data: {
        type: args.type,
        targetType: args.targetType,
        targetId: args.targetId,
        topicId: args.topicId ?? null,
        input: (args.input ?? {}) as Prisma.InputJsonValue,
        createdById: args.userId ?? null,
        economy: !!args.economy && isEconomyTask(args.type),
      },
    });
    // With the hard stop on and the month's budget used up, the job is recorded as failed (the
    // runner's onFailure cleans up whatever shell the caller created) instead of being run.
    const blocked = await this.budget.blockReason(args).catch(() => null);
    if (blocked) {
      const failed = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: blocked, finishedAt: new Date() },
      });
      await this.runners.get(job.type)?.onFailure?.(failed, blocked).catch(() => undefined);
      this.audit.log({
        userId: args.userId,
        action: 'ai.budget_blocked',
        entityType: args.targetType,
        entityId: args.targetId,
        meta: { jobId: job.id, type: args.type },
      });
      return failed;
    }
    await this.queue.enqueue(job.id);
    this.audit.log({
      userId: args.userId,
      action: `ai.${args.type.toLowerCase()}`,
      entityType: args.targetType,
      entityId: args.targetId,
      meta: { jobId: job.id },
    });
    return job;
  }

  /** Worker entry point. */
  async process(jobId: string, attempt: AttemptInfo): Promise<void> {
    const job = await this.prisma.aiJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === 'SUCCEEDED' || job.status === 'CANCELED') return;
    const runner = this.runners.get(job.type);
    if (!runner) throw new PermanentJobError(`No runner for ${job.type}`);

    await this.prisma.aiJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', attempts: attempt.attempt, startedAt: new Date(), error: null },
    });

    try {
      // an economy job's model calls may defer it; see batch/batch-context.ts
      const ctx: BatchContext = {
        jobId,
        economy: job.economy && isEconomyTask(job.type),
        seq: 0,
        promptChars: 0,
      };
      const result = await batchContext.run(ctx, () => runner.run(job));
      await this.prisma.aiJob.update({
        where: { id: jobId },
        data: {
          status: 'SUCCEEDED',
          output: result.output as Prisma.InputJsonValue,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          promptChars: ctx.unmeasured || !ctx.promptChars ? null : ctx.promptChars,
          costUsd: estimateCostUsd(result.model, result.usage),
          promptKey: result.prompt.key,
          promptVersion: result.prompt.version,
          finishedAt: new Date(),
        },
      });
      void this.budget.check();
    } catch (err) {
      if (err instanceof JobDeferredError) {
        // not a failure: the model call is with the vendor's batch queue; the poller wakes the job
        await this.prisma.aiJob.update({
          where: { id: jobId },
          data: { status: 'WAITING', error: null },
        });
        return;
      }
      const permanent =
        err instanceof NonRetryableAiError ||
        err instanceof PermanentJobError ||
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025');
      const final = permanent || attempt.attempt >= attempt.maxAttempts;
      const message = errorMessage(err);
      this.logger.warn(`job ${jobId} (${job.type}) attempt ${attempt.attempt} failed: ${message}`);

      await this.prisma.aiJob.update({
        where: { id: jobId },
        data: {
          status: final ? 'FAILED' : 'QUEUED',
          error: message,
          finishedAt: final ? new Date() : null,
        },
      });
      if (final) {
        await runner.onFailure?.(job, message).catch(() => undefined);
        await this.errors.record({
          source: 'AI_JOB',
          message: `${job.type} failed: ${message}`,
          detail: err instanceof Error ? err.stack : null,
          errorName: err instanceof Error ? err.name : null,
          jobId: job.id,
          userId: job.createdById,
          context: {
            type: job.type,
            targetType: job.targetType,
            targetId: job.targetId,
            attempts: attempt.attempt,
            topicId: job.topicId,
          },
        });
      }
      throw permanent ? new PermanentJobError(message) : err;
    }
  }

  async retry(jobId: string, userId: string) {
    const job = await this.get(jobId);
    if (job.status !== 'FAILED' && job.status !== 'CANCELED') {
      throw new BadRequestException('Only failed or canceled jobs can be retried');
    }
    await this.prisma.aiJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', error: null, startedAt: null, finishedAt: null },
    });
    await this.runners.get(job.type)?.onRetry?.(job);
    await this.queue.enqueue(jobId);
    this.audit.log({ userId, action: 'ai.job_retry', entityType: 'AiJob', entityId: jobId });
    return { jobId };
  }

  async cancel(jobId: string, userId: string) {
    const job = await this.get(jobId);
    if (job.status !== 'QUEUED') throw new BadRequestException('Only queued jobs can be canceled');
    await this.prisma.aiJob.update({
      where: { id: jobId },
      data: { status: 'CANCELED', finishedAt: new Date() },
    });
    await this.runners.get(job.type)?.onFailure?.(job, 'canceled');
    this.audit.log({ userId, action: 'ai.job_cancel', entityType: 'AiJob', entityId: jobId });
    return { jobId };
  }

  async get(jobId: string) {
    const job = await this.prisma.aiJob.findUnique({
      where: { id: jobId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async list(
    query: PaginationQuery & { status?: AiJobStatus; type?: AiJobType; topicId?: string },
  ) {
    const where: Prisma.AiJobWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
      ...(query.q ? { OR: [{ id: query.q }, { targetId: query.q }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true } } },
        ...paginate(query),
      }),
      this.prisma.aiJob.count({ where }),
    ]);
    return toPage(items, total, query);
  }
}
