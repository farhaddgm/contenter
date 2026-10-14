import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type AiBatchCall } from '@prisma/client';
import { ENV, type Env } from '../../../config/env';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { QueueService } from '../../../infra/queue/queue.service';
import { isBatchProvider } from '../provider/ai-provider';
import { AiProviderRegistry } from '../provider/provider-registry';

const TICK_MS = 60_000;
/** A call that could not even be submitted within this time runs live instead. */
export const SUBMIT_GIVE_UP_MS = 2 * 60 * 60 * 1000;
/** Vendors promise an answer within 24 hours; a little more and the call runs live. */
export const RESULT_GIVE_UP_MS = 26 * 60 * 60 * 1000;
const MAX_PER_BATCH = 200;

/**
 * Keeps the calls of economy-mode jobs: stores each prepared request, sends the waiting ones to
 * the vendor's batch API, collects the answers and wakes the jobs up (docs/44). Calls that the
 * vendor cannot deliver (rejected, expired, taking too long) are marked FAILED; the job then
 * runs that call live at the normal price, so economy mode can delay a result but not lose it.
 * Runs where the worker runs.
 */
@Injectable()
export class AiBatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiBatchService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: AiProviderRegistry,
    private readonly queue: QueueService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    const tick = () =>
      this.run().catch((err) => this.logger.warn(`batch run failed: ${(err as Error).message}`));
    setTimeout(tick, 15_000).unref();
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─────────────── used by the executor ───────────────

  find(jobId: string, seq: number): Promise<AiBatchCall | null> {
    return this.prisma.aiBatchCall.findUnique({ where: { jobId_seq: { jobId, seq } } });
  }

  async create(jobId: string, seq: number, model: string, params: Record<string, unknown>) {
    await this.prisma.aiBatchCall.upsert({
      where: { jobId_seq: { jobId, seq } },
      create: { jobId, seq, model, params: params as Prisma.InputJsonValue },
      update: {},
    });
  }

  // ─────────────── the worker loop ───────────────

  /** One round: submit what waits, collect what is done, wake the jobs. Returns what happened. */
  async run(now = new Date()): Promise<{ submitted: number; completed: number; woken: number }> {
    if (this.busy) return { submitted: 0, completed: 0, woken: 0 };
    this.busy = true;
    try {
      const submitted = await this.submitPending(now);
      const completed = await this.collect(now);
      const woken = await this.wake();
      return { submitted, completed, woken };
    } finally {
      this.busy = false;
    }
  }

  /** Groups waiting calls by model and submits each group as one batch. */
  private async submitPending(now: Date): Promise<number> {
    const pending = await this.prisma.aiBatchCall.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_BATCH * 5,
    });
    const byModel = new Map<string, AiBatchCall[]>();
    for (const c of pending) byModel.set(c.model, [...(byModel.get(c.model) ?? []), c]);

    let submitted = 0;
    for (const [model, calls] of byModel) {
      for (let i = 0; i < calls.length; i += MAX_PER_BATCH) {
        const group = calls.slice(i, i + MAX_PER_BATCH);
        try {
          const { provider } = this.providers.resolve(model);
          if (!isBatchProvider(provider)) throw new Error(`${model} has no batch API`);
          const { batchRef } = await provider.submitBatch(
            group.map((c) => ({ customId: c.id, params: c.params as Record<string, unknown> })),
          );
          await this.prisma.aiBatchCall.updateMany({
            where: { id: { in: group.map((c) => c.id) } },
            data: { status: 'SUBMITTED', batchRef },
          });
          submitted += group.length;
        } catch (err) {
          const message = (err as Error).message;
          this.logger.warn(`could not submit a batch of ${group.length} (${model}): ${message}`);
          // try again next round, but not forever: after a while the jobs run live
          const stale = group.filter((c) => now.getTime() - c.createdAt.getTime() > SUBMIT_GIVE_UP_MS);
          if (stale.length) {
            await this.fail(stale.map((c) => c.id), `Not submitted: ${message}`);
          }
        }
      }
    }
    return submitted;
  }

  /** Asks the vendor about every submitted batch and stores the answers that arrived. */
  private async collect(now: Date): Promise<number> {
    const submitted = await this.prisma.aiBatchCall.findMany({ where: { status: 'SUBMITTED' } });
    const byRef = new Map<string, AiBatchCall[]>();
    for (const c of submitted) {
      if (c.batchRef) byRef.set(c.batchRef, [...(byRef.get(c.batchRef) ?? []), c]);
    }

    let completed = 0;
    for (const [batchRef, calls] of byRef) {
      try {
        const { provider } = this.providers.resolve(calls[0].model);
        if (!isBatchProvider(provider)) throw new Error(`${calls[0].model} has no batch API`);
        const poll = await provider.pollBatch(batchRef);
        if (poll.state === 'running') {
          const late = calls.filter((c) => now.getTime() - c.createdAt.getTime() > RESULT_GIVE_UP_MS);
          if (late.length) {
            await this.fail(late.map((c) => c.id), 'The batch took longer than 26 hours');
          }
          continue;
        }
        if (poll.state === 'failed') {
          await this.fail(calls.map((c) => c.id), poll.error);
          continue;
        }
        for (const c of calls) {
          const r = poll.results[c.id];
          if (r?.ok) {
            await this.prisma.aiBatchCall.update({
              where: { id: c.id },
              data: { status: 'DONE', result: r.raw as Prisma.InputJsonValue, error: null },
            });
            completed += 1;
          } else {
            await this.fail([c.id], r ? r.error : 'The batch returned no answer for this request');
          }
        }
      } catch (err) {
        // a network or vendor hiccup: ask again next round
        this.logger.warn(`could not read batch ${batchRef}: ${(err as Error).message}`);
      }
    }
    return completed;
  }

  private fail(ids: string[], error: string) {
    return this.prisma.aiBatchCall.updateMany({
      where: { id: { in: ids } },
      data: { status: 'FAILED', error: error.slice(0, 1000) },
    });
  }

  /**
   * Every waiting job whose calls are all answered (or given up) runs again. Sweeping all waiting
   * jobs, not only the ones touched this round, also catches a job that was marked waiting just
   * after its last answer arrived.
   */
  private async wake(): Promise<number> {
    const waiting = await this.prisma.aiJob.findMany({
      where: { status: 'WAITING' },
      select: { id: true },
      take: 500,
    });
    let woken = 0;
    for (const { id: jobId } of waiting) {
      const open = await this.prisma.aiBatchCall.count({
        where: { jobId, status: { in: ['PENDING', 'SUBMITTED'] } },
      });
      if (open > 0) continue;
      const updated = await this.prisma.aiJob.updateMany({
        where: { id: jobId, status: 'WAITING' },
        data: { status: 'QUEUED' },
      });
      if (updated.count) {
        await this.queue.enqueue(jobId);
        woken += 1;
      }
    }
    return woken;
  }
}
