import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiJob } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { ErrorTrackerService } from '../smart/smart-core.services';
import type { QueueService } from '../../infra/queue/queue.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { SettingsService } from '../settings/settings.module';
import type { AiAlertsService } from './ai-alerts.service';
import { AiExecutor } from './ai-executor.service';
import { AiJobsService } from './ai-jobs.service';
import type { AiBatchService } from './batch/ai-batch.service';
import { batchContext, type BatchContext } from './batch/batch-context';
import type { BudgetService } from './budget.service';
import type { AiProvider, StructuredRequest } from './provider/ai-provider';
import type { AiProviderRegistry } from './provider/provider-registry';
import type { PromptService } from './prompts/prompt.service';
import type { AiRunner } from './runners/runner';

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
const schema = z.object({ ok: z.boolean() });

function executor(opts: { system?: string; user?: string } = {}) {
  const provider: AiProvider = {
    name: 'plain',
    research: vi.fn(async () => ({ notes: 'n', sources: [], model: 'm', usage })),
    generateStructured: async <T>(req: StructuredRequest<T>) => ({
      data: { ok: true } as T,
      model: req.model,
      usage,
    }),
  };
  const registry = {
    resolve: (ref: string) => ({ provider, model: ref.split(':')[1] }),
    isConfigured: () => true,
  } as unknown as AiProviderRegistry;
  const prompts = {
    resolve: async () => ({ key: 'k', version: 1, system: opts.system ?? 'sys', user: opts.user ?? 'user' }),
  } as unknown as PromptService;
  const settings = {
    modelFor: async () => ({ model: 'openai:gpt-x', effort: 'low' as const }),
    fallbackRef: async () => '',
  } as unknown as SettingsService;
  const alerts = { send: vi.fn() } as unknown as AiAlertsService;
  return new AiExecutor(registry, prompts, settings, alerts, {} as unknown as AiBatchService);
}

const call = (exec: AiExecutor) =>
  exec.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema });

describe('prompt size of a run (docs/66)', () => {
  it('sums the system and user text of every model call of the run', async () => {
    const exec = executor({ system: 'abc', user: 'defgh' });
    const ctx: BatchContext = { jobId: 'j', economy: false, seq: 0 };
    await batchContext.run(ctx, async () => {
      await call(exec);
      await call(exec);
    });
    expect(ctx.promptChars).toBe(16);
    expect(ctx.unmeasured).toBeUndefined();
  });

  it('is left out when images or web search add tokens the text does not explain', async () => {
    const exec = executor();
    const withImage: BatchContext = { jobId: 'j', economy: false, seq: 0 };
    await batchContext.run(withImage, () =>
      exec.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema, imageUrls: ['https://x/y.png'] }),
    );
    expect(withImage.unmeasured).toBe(true);

    const searched: BatchContext = { jobId: 'j', economy: false, seq: 0 };
    await batchContext.run(searched, () =>
      exec.research({ task: 'BUSINESS_BUILD', promptKey: 'business_research', vars: {}, maxSearches: 1 }),
    );
    expect(searched.unmeasured).toBe(true);
  });

  it('does nothing outside a job run', async () => {
    await expect(call(executor())).resolves.toMatchObject({ data: { ok: true } });
  });
});

describe('AiJobsService stores the prompt size', () => {
  function jobs(runner: AiRunner) {
    const updates: Partial<AiJob>[] = [];
    const job = { id: 'j1', type: runner.type, status: 'QUEUED', economy: false } as Partial<AiJob>;
    const prisma = {
      aiJob: {
        findUnique: async () => job,
        update: async ({ data }: { data: Partial<AiJob> }) => {
          updates.push(data);
          Object.assign(job, data);
          return job;
        },
      },
    };
    const svc = new AiJobsService(
      prisma as unknown as PrismaService,
      { registerHandler: vi.fn(), enqueue: vi.fn() } as unknown as QueueService,
      { log: vi.fn() } as unknown as AuditService,
      { record: vi.fn() } as unknown as ErrorTrackerService,
      { blockReason: vi.fn(), check: vi.fn() } as unknown as BudgetService,
      [runner],
    );
    return { svc, updates };
  }

  const runnerOf = (mark: (ctx: BatchContext) => void): AiRunner => ({
    type: 'IDEATE',
    run: async () => {
      mark(batchContext.getStore()!);
      return { output: {}, model: 'm', usage, prompt: { key: 'k', version: 1 } };
    },
  });

  it('records the characters the run sent', async () => {
    const { svc, updates } = jobs(runnerOf((c) => (c.promptChars = 1234)));
    await svc.process('j1', { attempt: 1, maxAttempts: 3 });
    expect(updates.find((u) => u.status === 'SUCCEEDED')?.promptChars).toBe(1234);
  });

  it('records nothing when the run could not be measured, or sent nothing', async () => {
    const a = jobs(runnerOf((c) => ((c.promptChars = 99), (c.unmeasured = true))));
    await a.svc.process('j1', { attempt: 1, maxAttempts: 3 });
    expect(a.updates.find((u) => u.status === 'SUCCEEDED')?.promptChars).toBeNull();

    const b = jobs(runnerOf(() => undefined));
    await b.svc.process('j1', { attempt: 1, maxAttempts: 3 });
    expect(b.updates.find((u) => u.status === 'SUCCEEDED')?.promptChars).toBeNull();
  });
});
