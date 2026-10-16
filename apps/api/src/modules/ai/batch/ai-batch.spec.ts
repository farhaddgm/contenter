import type { AiBatchCall, AiJob } from '@prisma/client';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Env } from '../../../config/env';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { QueueService } from '../../../infra/queue/queue.service';
import type { AuditService } from '../../audit/audit.service';
import type { ErrorTrackerService } from '../../smart/smart-core.services';
import type { SettingsService } from '../../settings/settings.module';
import { AiAlertsService } from '../ai-alerts.service';
import { AiExecutor } from '../ai-executor.service';
import { AiJobsService } from '../ai-jobs.service';
import type { BudgetService } from '../budget.service';
import { estimateCostUsd } from '../pricing';
import type { PromptService } from '../prompts/prompt.service';
import {
  sumUsage,
  type AiProvider,
  type BatchPoll,
  type BatchProvider,
  type StructuredRequest,
} from '../provider/ai-provider';
import { AnthropicProvider } from '../provider/anthropic.provider';
import { MockProvider } from '../provider/mock.provider';
import { OpenAiProvider } from '../provider/openai.provider';
import type { AiProviderRegistry } from '../provider/provider-registry';
import type { AiRunner } from '../runners/runner';
import { AiBatchService, RESULT_GIVE_UP_MS, SUBMIT_GIVE_UP_MS } from './ai-batch.service';
import { batchContext, JobDeferredError } from './batch-context';

const schema = z.object({ ok: z.boolean(), n: z.number() });
const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

// ───────────────────────── a tiny in-memory AiBatchCall / AiJob store ─────────────────────────

function store() {
  const calls: AiBatchCall[] = [];
  const jobs = new Map<string, Partial<AiJob>>();
  let n = 0;
  const match = (c: AiBatchCall, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const x = (c as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'in' in (v as object)) return (v as { in: unknown[] }).in.includes(x);
      return x === v;
    });
  const prisma = {
    aiBatchCall: {
      findUnique: async ({ where }: { where: { jobId_seq: { jobId: string; seq: number } } }) =>
        calls.find((c) => c.jobId === where.jobId_seq.jobId && c.seq === where.jobId_seq.seq) ?? null,
      upsert: async ({ where, create }: { where: { jobId_seq: { jobId: string; seq: number } }; create: Partial<AiBatchCall> }) => {
        if (!calls.some((c) => c.jobId === where.jobId_seq.jobId && c.seq === where.jobId_seq.seq)) {
          calls.push({
            id: `call${++n}`,
            status: 'PENDING',
            batchRef: null,
            result: null,
            error: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          } as AiBatchCall);
        }
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => calls.filter((c) => match(c, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<AiBatchCall> }) => {
        const hit = calls.filter((c) => match(c, where));
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<AiBatchCall> }) => {
        Object.assign(calls.find((c) => c.id === where.id)!, data);
      },
      count: async ({ where }: { where: Record<string, unknown> }) => calls.filter((c) => match(c, where)).length,
    },
    aiJob: {
      findMany: async ({ where }: { where: { status: string } }) =>
        [...jobs.entries()].filter(([, j]) => j.status === where.status).map(([id]) => ({ id })),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<AiJob> }) => {
        const j = jobs.get(where.id);
        if (j && j.status === where.status) {
          Object.assign(j, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  return { calls, jobs, prisma };
}

// ───────────────────────── a batch-capable fake provider ─────────────────────────

function fakeProvider(opts: { poll?: () => BatchPoll; submitFails?: boolean } = {}) {
  const submitted: { customId: string; params: Record<string, unknown> }[][] = [];
  const live = vi.fn(async <T>(req: StructuredRequest<T>) => ({
    data: { ok: true, n: 99 } as T,
    model: req.model,
    usage,
  }));
  const provider: AiProvider & BatchProvider = {
    name: 'fake',
    research: vi.fn(),
    generateStructured: live,
    buildBatchParams: async (req) => ({ model: req.model, user: req.user }),
    submitBatch: async (items) => {
      if (opts.submitFails) throw new Error('vendor said no');
      submitted.push(items);
      return { batchRef: `batch${submitted.length}` };
    },
    pollBatch: async () => (opts.poll ? opts.poll() : { state: 'running' }),
    parseBatchResult: <T>(raw: unknown, s: z.ZodType<T>) => ({
      data: s.parse((raw as { data: unknown }).data),
      model: 'm',
      usage,
    }),
  };
  return { provider, submitted, live };
}

function service(prisma: unknown, provider: AiProvider, queue = { enqueue: vi.fn(async () => undefined) }) {
  const registry = {
    resolve: (ref: string) => ({ provider, model: ref.split(':')[1] ?? ref }),
    isConfigured: () => true,
  } as unknown as AiProviderRegistry;
  const svc = new AiBatchService(
    prisma as PrismaService,
    registry,
    queue as unknown as QueueService,
    { APP_ROLE: 'api', NODE_ENV: 'test' } as unknown as Env,
  );
  return { svc, queue };
}

describe('AiBatchService.run', () => {
  const oldCall = (over: Partial<AiBatchCall>): AiBatchCall =>
    ({
      id: 'x',
      jobId: 'j1',
      seq: 0,
      model: 'openai:gpt-x',
      params: { p: 1 },
      status: 'PENDING',
      batchRef: null,
      result: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as AiBatchCall;

  it('submits waiting calls as one batch per model and marks them submitted', async () => {
    const { prisma, calls } = store();
    calls.push(oldCall({ id: 'a', jobId: 'j1' }), oldCall({ id: 'b', jobId: 'j2' }), oldCall({ id: 'c', jobId: 'j3', model: 'anthropic:claude-y' }));
    const { provider, submitted } = fakeProvider();
    const { svc } = service(prisma, provider);
    const r = await svc.run();
    expect(r.submitted).toBe(3);
    expect(submitted).toHaveLength(2);
    expect(submitted.map((b) => b.map((i) => i.customId).sort())).toEqual([['a', 'b'], ['c']]);
    expect(calls.every((c) => c.status === 'SUBMITTED' && c.batchRef)).toBe(true);
  });

  it('stores the answers that arrive, marks the missing ones failed and wakes the finished job', async () => {
    const { prisma, calls, jobs } = store();
    jobs.set('j1', { status: 'WAITING' });
    jobs.set('j2', { status: 'WAITING' });
    calls.push(
      oldCall({ id: 'a', jobId: 'j1', status: 'SUBMITTED', batchRef: 'B' }),
      oldCall({ id: 'b', jobId: 'j2', status: 'SUBMITTED', batchRef: 'B' }),
    );
    const { provider } = fakeProvider({
      poll: () => ({
        state: 'done',
        results: { a: { ok: true, raw: { data: { ok: true, n: 1 } } } }, // b is missing
      }),
    });
    const { svc, queue } = service(prisma, provider);
    const r = await svc.run();
    expect(calls.find((c) => c.id === 'a')).toMatchObject({ status: 'DONE', result: { data: { ok: true, n: 1 } } });
    expect(calls.find((c) => c.id === 'b')).toMatchObject({ status: 'FAILED' });
    expect(r).toMatchObject({ completed: 1, woken: 2 });
    expect(jobs.get('j1')?.status).toBe('QUEUED');
    expect(jobs.get('j2')?.status).toBe('QUEUED'); // a failed call also wakes the job: it runs live
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('keeps asking while the vendor is still working, and wakes nothing', async () => {
    const { prisma, calls, jobs } = store();
    jobs.set('j1', { status: 'WAITING' });
    calls.push(oldCall({ id: 'a', status: 'SUBMITTED', batchRef: 'B' }));
    const { svc, queue } = service(prisma, fakeProvider({ poll: () => ({ state: 'running' }) }).provider);
    expect(await svc.run()).toMatchObject({ completed: 0, woken: 0 });
    expect(calls[0].status).toBe('SUBMITTED');
    expect(jobs.get('j1')?.status).toBe('WAITING');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('fails every call of a batch the vendor reports as failed', async () => {
    const { prisma, calls, jobs } = store();
    jobs.set('j1', { status: 'WAITING' });
    calls.push(oldCall({ id: 'a', status: 'SUBMITTED', batchRef: 'B' }));
    const { svc } = service(prisma, fakeProvider({ poll: () => ({ state: 'failed', error: 'expired' }) }).provider);
    await svc.run();
    expect(calls[0]).toMatchObject({ status: 'FAILED', error: 'expired' });
    expect(jobs.get('j1')?.status).toBe('QUEUED');
  });

  it('gives up on a batch that takes too long and on a submission that never works', async () => {
    const { prisma, calls, jobs } = store();
    jobs.set('j1', { status: 'WAITING' });
    jobs.set('j2', { status: 'WAITING' });
    const old = (ms: number) => new Date(Date.now() - ms);
    calls.push(
      oldCall({ id: 'late', jobId: 'j1', status: 'SUBMITTED', batchRef: 'B', createdAt: old(RESULT_GIVE_UP_MS + 1000) }),
      oldCall({ id: 'stuck', jobId: 'j2', status: 'PENDING', createdAt: old(SUBMIT_GIVE_UP_MS + 1000) }),
    );
    const { svc } = service(prisma, fakeProvider({ poll: () => ({ state: 'running' }), submitFails: true }).provider);
    await svc.run();
    expect(calls.find((c) => c.id === 'late')?.status).toBe('FAILED');
    expect(calls.find((c) => c.id === 'stuck')).toMatchObject({ status: 'FAILED', error: expect.stringContaining('vendor said no') });
  });

  it('retries a submission that failed a moment ago on the next round', async () => {
    const { prisma, calls } = store();
    calls.push(oldCall({ id: 'a' }));
    const { svc } = service(prisma, fakeProvider({ submitFails: true }).provider);
    await svc.run();
    expect(calls[0].status).toBe('PENDING');
  });

  it('wakes a waiting job that has no open calls even if nothing changed this round', async () => {
    const { prisma, jobs } = store();
    jobs.set('j9', { status: 'WAITING' });
    const { svc, queue } = service(prisma, fakeProvider().provider);
    expect((await svc.run()).woken).toBe(1);
    expect(queue.enqueue).toHaveBeenCalledWith('j9');
  });
});

// ───────────────────────── the executor in economy mode ─────────────────────────

function executorWith(provider: AiProvider, st = store()) {
  const registry = {
    resolve: (ref: string) => ({ provider, model: ref.split(':')[1] }),
    isConfigured: () => true,
  } as unknown as AiProviderRegistry;
  const prompts = { resolve: async () => ({ key: 'k', version: 1, system: 's', user: 'u' }) } as unknown as PromptService;
  const settings = {
    modelFor: async () => ({ model: 'openai:gpt-x', effort: 'low' as const }),
    fallbackRef: async () => '',
  } as unknown as SettingsService;
  const alerts = { send: vi.fn() } as unknown as AiAlertsService;
  const { svc: batches } = service(st.prisma, provider);
  return { exec: new AiExecutor(registry, prompts, settings, alerts, batches), st };
}

const run = (exec: AiExecutor, ctx = { jobId: 'j1', economy: true, seq: 0 }) =>
  batchContext.run(ctx, () => exec.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema }));

describe('AiExecutor economy mode', () => {
  it('stores the request and defers the job on the first run', async () => {
    const { provider, live } = fakeProvider();
    const { exec, st } = executorWith(provider);
    await expect(run(exec)).rejects.toBeInstanceOf(JobDeferredError);
    expect(st.calls).toHaveLength(1);
    expect(st.calls[0]).toMatchObject({ jobId: 'j1', seq: 0, status: 'PENDING', model: 'openai:gpt-x' });
    expect(live).not.toHaveBeenCalled();
    // asking again while it is pending defers again without a second call
    await expect(run(exec)).rejects.toBeInstanceOf(JobDeferredError);
    expect(st.calls).toHaveLength(1);
  });

  it('returns the stored answer once it is done, billed as a batch call', async () => {
    const { provider, live } = fakeProvider();
    const { exec, st } = executorWith(provider);
    await expect(run(exec)).rejects.toBeInstanceOf(JobDeferredError);
    Object.assign(st.calls[0], { status: 'DONE', result: { data: { ok: true, n: 7 } } });
    const r = await run(exec);
    expect(r.data).toEqual({ ok: true, n: 7 });
    expect(r.usage.batch).toBe(true);
    expect(live).not.toHaveBeenCalled();
    const base = estimateCostUsd('gpt-5', { ...usage });
    expect(estimateCostUsd('gpt-5', { ...usage, batch: true })).toBeCloseTo(base / 2, 6);
  });

  it('matches calls by position: the first is replayed, the second defers', async () => {
    const { provider } = fakeProvider();
    const { exec, st } = executorWith(provider);
    await expect(run(exec)).rejects.toBeInstanceOf(JobDeferredError);
    Object.assign(st.calls[0], { status: 'DONE', result: { data: { ok: true, n: 1 } } });
    const ctx = { jobId: 'j1', economy: true, seq: 0 };
    const exec2 = (c: typeof ctx) =>
      batchContext.run(c, async () => {
        const first = await exec.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema });
        const second = await exec.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema });
        return [first, second];
      });
    await expect(exec2(ctx)).rejects.toBeInstanceOf(JobDeferredError);
    expect(st.calls.map((c) => c.seq)).toEqual([0, 1]);
    expect(ctx.seq).toBe(2);
  });

  it('runs live, at the normal price, when the batch failed — and for the rest of the run', async () => {
    const { provider, live } = fakeProvider();
    const { exec, st } = executorWith(provider);
    await expect(run(exec)).rejects.toBeInstanceOf(JobDeferredError);
    Object.assign(st.calls[0], { status: 'FAILED', error: 'expired' });
    const r = await run(exec);
    expect(r.data).toEqual({ ok: true, n: 99 });
    expect(r.usage.batch).toBeUndefined();
    expect(live).toHaveBeenCalledTimes(1);
  });

  it('runs live when the provider has no batch API or the job is not in economy mode', async () => {
    const plain: AiProvider = {
      name: 'plain',
      research: vi.fn(),
      generateStructured: async <T>(req: StructuredRequest<T>) => ({ data: { ok: true, n: 5 } as T, model: req.model, usage }),
    };
    const { exec, st } = executorWith(plain);
    expect((await run(exec)).data.n).toBe(5);
    expect(st.calls).toHaveLength(0);
    const { exec: exec2 } = executorWith(fakeProvider().provider);
    const live = await exec2.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema });
    expect(live.data.n).toBe(99);
  });

  it('counts a job as a batch job only when every call was one', () => {
    expect(sumUsage({ ...usage, batch: true }, { ...usage, batch: true }).batch).toBe(true);
    expect(sumUsage({ ...usage, batch: true }, usage).batch).toBeUndefined();
  });
});

// ───────────────────────── the job service ─────────────────────────

describe('AiJobsService economy jobs', () => {
  function jobsService(runner: AiRunner, job: Partial<AiJob>) {
    const updates: Partial<AiJob>[] = [];
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

  it('marks a deferred job WAITING instead of failed, and passes the economy flag to the run', async () => {
    const seen: boolean[] = [];
    const runner: AiRunner = {
      type: 'IDEATE',
      run: async () => {
        seen.push(batchContext.getStore()!.economy);
        throw new JobDeferredError();
      },
    };
    const job = { id: 'j1', type: 'IDEATE', status: 'QUEUED', economy: true } as Partial<AiJob>;
    const { svc, updates } = jobsService(runner, job);
    await svc.process('j1', { attempt: 1, maxAttempts: 3 });
    expect(seen).toEqual([true]);
    expect(job.status).toBe('WAITING');
    expect(updates.some((u) => u.status === 'FAILED')).toBe(false);
  });

  it('ignores the flag for a task that cannot be batched', async () => {
    const seen: boolean[] = [];
    const runner: AiRunner = {
      type: 'BUSINESS_BUILD',
      run: async () => {
        seen.push(batchContext.getStore()!.economy);
        return { output: {}, model: 'm', usage, prompt: { key: 'k', version: 1 } };
      },
    };
    const job = { id: 'j2', type: 'BUSINESS_BUILD', status: 'QUEUED', economy: true } as Partial<AiJob>;
    const { svc } = jobsService(runner, job);
    await svc.process('j2', { attempt: 1, maxAttempts: 3 });
    expect(seen).toEqual([false]);
    expect(job.status).toBe('SUCCEEDED');
  });

  it('a real failure of an economy job still fails it', async () => {
    const runner: AiRunner = {
      type: 'IDEATE',
      run: async () => {
        throw new Error('boom');
      },
    };
    const job = { id: 'j3', type: 'IDEATE', status: 'QUEUED', economy: true } as Partial<AiJob>;
    const { svc } = jobsService(runner, job);
    await expect(svc.process('j3', { attempt: 3, maxAttempts: 3 })).rejects.toThrow('boom');
    expect(job.status).toBe('FAILED');
  });
});

// ───────────────────────── the vendors' batch formats ─────────────────────────

const openAiBody = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'resp_1',
  model: 'gpt-5-2026',
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 1200, output_tokens: 300, input_tokens_details: { cached_tokens: 200 } },
  ...extra,
});

describe('OpenAI batch format', () => {
  const provider = new OpenAiProvider('sk-test');

  it('reads a batch response body without the SDK helper, with disjoint token buckets', () => {
    const r = provider.parseBatchResult(openAiBody('{"ok":true,"n":3}'), schema);
    expect(r.data).toEqual({ ok: true, n: 3 });
    expect(r.model).toBe('gpt-5-2026');
    expect(r.usage).toMatchObject({ inputTokens: 1000, cacheReadTokens: 200, outputTokens: 300 });
  });

  it('rejects refusals, truncation, bad JSON and bad shapes like a live call', () => {
    expect(() => provider.parseBatchResult(openAiBody('{"ok":1}'), schema)).toThrow(/failed validation/);
    expect(() => provider.parseBatchResult(openAiBody('nope'), schema)).toThrow(/invalid JSON/);
    expect(() =>
      provider.parseBatchResult(openAiBody('', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), schema),
    ).toThrow(/truncated/);
    expect(() =>
      provider.parseBatchResult(
        openAiBody('', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }),
        schema,
      ),
    ).toThrow(/declined/);
  });

  it('builds a plain Responses request, submits a JSONL batch and reads its output file', async () => {
    const params = await provider.buildBatchParams({
      task: 'IDEATE',
      model: 'gpt-5',
      effort: 'low',
      system: 'sys',
      user: 'usr',
      schema,
    });
    expect(params).toMatchObject({ model: 'gpt-5', instructions: 'sys', store: false });
    expect(params).not.toHaveProperty('stream');
    expect(JSON.stringify(params)).toContain('json_schema');

    let uploaded = '';
    const created: Record<string, unknown>[] = [];
    const lines = [
      JSON.stringify({ custom_id: 'a', response: { status_code: 200, body: openAiBody('{"ok":true,"n":1}') } }),
      JSON.stringify({ custom_id: 'b', response: { status_code: 400, body: { error: { message: 'bad input' } } } }),
    ].join('\n');
    (provider as unknown as { client: unknown }).client = {
      files: {
        create: async ({ file }: { file: File }) => {
          uploaded = await file.text();
          return { id: 'file-1' };
        },
        content: async () => ({ text: async () => lines }),
      },
      batches: {
        create: async (b: Record<string, unknown>) => {
          created.push(b);
          return { id: 'batch_1' };
        },
        retrieve: async () => ({ status: 'completed', output_file_id: 'out-1', error_file_id: null }),
      },
    } as unknown as OpenAI;

    const { batchRef } = await provider.submitBatch([{ customId: 'a', params }]);
    expect(batchRef).toBe('batch_1');
    expect(created[0]).toMatchObject({ input_file_id: 'file-1', endpoint: '/v1/responses', completion_window: '24h' });
    const row = JSON.parse(uploaded.trim());
    expect(row).toMatchObject({ custom_id: 'a', method: 'POST', url: '/v1/responses' });
    expect(row.body.model).toBe('gpt-5');

    const poll = await provider.pollBatch('batch_1');
    expect(poll.state).toBe('done');
    if (poll.state === 'done') {
      expect(poll.results.a).toMatchObject({ ok: true });
      expect(poll.results.b).toEqual({ ok: false, error: 'bad input' });
    }
  });

  it('says running while the batch is in progress and failed when it ended without files', async () => {
    const client = (status: string) =>
      ({
        batches: { retrieve: async () => ({ status, output_file_id: null, error_file_id: null, errors: { data: [{ message: 'invalid file' }] } }) },
      }) as unknown as OpenAI;
    (provider as unknown as { client: unknown }).client = client('in_progress');
    expect(await provider.pollBatch('x')).toEqual({ state: 'running' });
    (provider as unknown as { client: unknown }).client = client('failed');
    expect(await provider.pollBatch('x')).toEqual({ state: 'failed', error: 'invalid file' });
  });
});

describe('Anthropic batch format', () => {
  const provider = new AnthropicProvider('sk-ant-test', false);
  const message = (text: string, over: Record<string, unknown> = {}) => ({
    model: 'claude-y',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  });

  it('reads a batch message like a live one', () => {
    const r = provider.parseBatchResult(message('{"ok":true,"n":2}'), schema);
    expect(r.data).toEqual({ ok: true, n: 2 });
    expect(r.usage).toMatchObject({ inputTokens: 800, outputTokens: 200 });
    expect(() => provider.parseBatchResult(message('', { stop_reason: 'refusal' }), schema)).toThrow(/declined/);
    expect(() => provider.parseBatchResult(message('', { stop_reason: 'max_tokens' }), schema)).toThrow(/truncated/);
    expect(() => provider.parseBatchResult(message('{"ok":"x"}'), schema)).toThrow(/failed validation/);
  });

  it('builds the request without streaming flags, submits it and reads the results', async () => {
    const params = await provider.buildBatchParams({
      task: 'IDEATE',
      model: 'claude-y',
      effort: 'low',
      system: 'sys',
      user: 'usr',
      schema,
    });
    expect(params).toMatchObject({ model: 'claude-y', thinking: { type: 'adaptive' } });
    expect(params).not.toHaveProperty('betas');

    const requests: unknown[] = [];
    async function* results() {
      yield { custom_id: 'a', result: { type: 'succeeded', message: message('{"ok":true,"n":1}') } };
      yield { custom_id: 'b', result: { type: 'errored', error: { error: { message: 'overloaded' } } } };
      yield { custom_id: 'c', result: { type: 'expired' } };
    }
    (provider as unknown as { client: unknown }).client = {
      beta: {
        messages: {
          batches: {
            create: async (b: { requests: unknown[] }) => {
              requests.push(...b.requests);
              return { id: 'msgbatch_1' };
            },
            retrieve: async () => ({ processing_status: 'ended' }),
            results: async () => results(),
          },
        },
      },
    };
    const { batchRef } = await provider.submitBatch([{ customId: 'a', params }]);
    expect(batchRef).toBe('msgbatch_1');
    expect(requests[0]).toMatchObject({ custom_id: 'a' });
    const poll = await provider.pollBatch('msgbatch_1');
    expect(poll.state).toBe('done');
    if (poll.state === 'done') {
      expect(poll.results.a).toMatchObject({ ok: true });
      expect(poll.results.b).toEqual({ ok: false, error: 'overloaded' });
      expect(poll.results.c).toEqual({ ok: false, error: 'The request was expired' });
    }
  });

  it('says running until the batch has ended', async () => {
    (provider as unknown as { client: unknown }).client = {
      beta: { messages: { batches: { retrieve: async () => ({ processing_status: 'in_progress' }) } } },
    };
    expect(await provider.pollBatch('x')).toEqual({ state: 'running' });
  });
});

describe('MockProvider batch', () => {
  it('answers at once so economy mode works in development', async () => {
    const mock = new MockProvider();
    const params = await mock.buildBatchParams({
      task: 'IDEATE',
      model: 'm',
      effort: 'low',
      system: 's',
      user: '<count>2</count>',
      schema: z.object({ ideas: z.array(z.any()) }),
    });
    const { batchRef } = await mock.submitBatch([{ customId: 'a', params }]);
    const poll = await mock.pollBatch(batchRef);
    expect(poll.state).toBe('done');
    if (poll.state === 'done') {
      const parsed = mock.parseBatchResult(poll.results.a && 'raw' in poll.results.a ? poll.results.a.raw : null, z.object({ ideas: z.array(z.any()) }));
      expect(Array.isArray(parsed.data.ideas)).toBe(true);
    }
    expect((await mock.pollBatch('unknown')).state).toBe('failed');
  });
});
