import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiExecutor } from './ai-executor.service';
import type { AiAlertsService } from './ai-alerts.service';
import {
  isProviderDown,
  NonRetryableAiError,
  ProviderOverloadedError,
  ProviderUnavailableError,
  type AiProvider,
  type StructuredRequest,
} from './provider/ai-provider';
import { permanentOrRaw as anthropicMap } from './provider/anthropic.provider';
import { permanentOrRaw as openaiMap } from './provider/openai.provider';
import type { AiProviderRegistry } from './provider/provider-registry';
import type { PromptService } from './prompts/prompt.service';
import type { SettingsService } from '../settings/settings.module';

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
const schema = z.object({ ok: z.boolean() });

/** A provider whose answer or failure is chosen per model id. */
function provider(behaviour: Record<string, () => unknown>): AiProvider {
  const pick = async (model: string) => {
    const b = behaviour[model];
    if (!b) throw new Error(`unexpected model ${model}`);
    const v = b();
    if (v instanceof Error) throw v;
    return v;
  };
  return {
    name: 'fake',
    generateStructured: async <T>(req: StructuredRequest<T>) => ({
      data: (await pick(req.model)) as T,
      model: req.model,
      usage,
    }),
    research: async (req) => {
      const text = (await pick(req.model)) as string;
      return { text, sources: [], model: req.model, usage };
    },
  };
}

function setup(opts: {
  behaviour: Record<string, () => unknown>;
  fallback?: string;
  configured?: string[];
  primary?: string;
}) {
  const primary = opts.primary ?? 'openai:gpt-x';
  const resolve = vi.fn((ref: string) => ({
    provider: provider(opts.behaviour),
    model: ref.split(':')[1],
  }));
  const registry = {
    resolve,
    isConfigured: (ref: string) => (opts.configured ?? ['anthropic:claude-y']).includes(ref),
  } as unknown as AiProviderRegistry;
  const prompts = {
    resolve: async () => ({ key: 'k', version: 1, system: 'sys', user: 'usr' }),
  } as unknown as PromptService;
  const settings = {
    modelFor: async () => ({ model: primary, effort: 'low' as const }),
    fallbackRef: async () => opts.fallback ?? '',
  } as unknown as SettingsService;
  const send = vi.fn(async () => true);
  const alerts = { send } as unknown as AiAlertsService;
  return { exec: new AiExecutor(registry, prompts, settings, alerts), resolve, send };
}

const run = (exec: AiExecutor) =>
  exec.execute({ task: 'IDEATE', promptKey: 'ideate', vars: {}, schema });

const quota = () => new ProviderUnavailableError('out of credit', 'quota');

describe('AiExecutor fallback', () => {
  it('uses the chosen model and no fallback when it works', async () => {
    const { exec, send } = setup({
      behaviour: { 'gpt-x': () => ({ ok: true }) },
      fallback: 'anthropic:claude-y',
    });
    const r = await run(exec);
    expect(r.model).toBe('gpt-x');
    expect(r.fallbackFrom).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('switches to the fallback model when the vendor is out of credit, and warns the admins', async () => {
    const { exec, send } = setup({
      behaviour: { 'gpt-x': quota, 'claude-y': () => ({ ok: true }) },
      fallback: 'anthropic:claude-y',
    });
    const r = await run(exec);
    expect(r.model).toBe('claude-y');
    expect(r.fallbackFrom).toBe('openai:gpt-x');
    expect(send).toHaveBeenCalledWith(
      'fallback:openai',
      'AI_FALLBACK_USED',
      expect.stringContaining('openai:gpt-x → anthropic:claude-y'),
    );
  });

  it('also covers an overloaded or unreachable vendor', async () => {
    for (const reason of ['overloaded', 'network'] as const) {
      const { exec } = setup({
        behaviour: {
          'gpt-x': () => new ProviderOverloadedError('503', reason),
          'claude-y': () => ({ ok: true }),
        },
        fallback: 'anthropic:claude-y',
      });
      expect((await run(exec)).model).toBe('claude-y');
    }
  });

  it('does not fall back when none is set, when it is the same model, or when its vendor has no key', async () => {
    const behaviour = { 'gpt-x': quota, 'claude-y': () => ({ ok: true }) };
    await expect(run(setup({ behaviour }).exec)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      run(setup({ behaviour, fallback: 'openai:gpt-x', configured: ['openai:gpt-x'] }).exec),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      run(setup({ behaviour, fallback: 'anthropic:claude-y', configured: [] }).exec),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('never falls back for a request the model itself rejects', async () => {
    const { exec, resolve } = setup({
      behaviour: {
        'gpt-x': () => new NonRetryableAiError('Model output failed validation'),
        'claude-y': () => ({ ok: true }),
      },
      fallback: 'anthropic:claude-y',
    });
    await expect(run(exec)).rejects.toThrow('failed validation');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('reports the vendor problem when the fallback is down too, and the fallback error when it fails differently', async () => {
    const down = setup({
      behaviour: { 'gpt-x': quota, 'claude-y': () => new ProviderOverloadedError('503', 'overloaded') },
      fallback: 'anthropic:claude-y',
    });
    await expect(run(down.exec)).rejects.toThrow('out of credit');
    expect(down.send).not.toHaveBeenCalled();

    const other = setup({
      behaviour: { 'gpt-x': quota, 'claude-y': () => new NonRetryableAiError('bad json') },
      fallback: 'anthropic:claude-y',
    });
    await expect(run(other.exec)).rejects.toThrow('bad json');
  });

  it('falls back for web research as well', async () => {
    const { exec } = setup({
      behaviour: { 'gpt-x': quota, 'claude-y': () => 'notes' },
      fallback: 'anthropic:claude-y',
    });
    const r = await exec.research({ task: 'BUSINESS_BUILD', promptKey: 'business_research', vars: {}, maxSearches: 3 });
    expect(r.text).toBe('notes');
    expect(r.model).toBe('claude-y');
  });
});

describe('vendor errors', () => {
  const headers = new Headers();

  it('classifies OpenAI failures', () => {
    const gen = (status: number, body: Record<string, unknown>) =>
      OpenAI.APIError.generate(status, body, 'msg', headers);
    expect(openaiMap(gen(429, { error: { code: 'insufficient_quota', message: 'm' } }))).toMatchObject({
      reason: 'quota',
    });
    expect(openaiMap(gen(401, { error: { message: 'bad key' } }))).toMatchObject({ reason: 'auth' });
    expect(openaiMap(gen(403, { error: { message: 'no' } }))).toMatchObject({ reason: 'auth' });
    expect(openaiMap(gen(400, { error: { message: 'bad' } }))).toBeInstanceOf(NonRetryableAiError);
    expect(isProviderDown(openaiMap(gen(400, { error: { message: 'bad' } })))).toBe(false);
    const rate = openaiMap(gen(429, { error: { code: 'rate_limit_exceeded', message: 'slow' } }));
    expect(rate).toBeInstanceOf(ProviderOverloadedError);
    expect(openaiMap(gen(500, { error: { message: 'oops' } }))).toBeInstanceOf(ProviderOverloadedError);
    expect(openaiMap(new OpenAI.APIConnectionError({ message: 'down' }))).toMatchObject({
      reason: 'network',
    });
    const plain = new Error('x');
    expect(openaiMap(plain)).toBe(plain);
  });

  it('classifies Anthropic failures, including an empty balance reported as a 400', () => {
    const gen = (status: number, message: string) =>
      Anthropic.APIError.generate(
        status,
        { type: 'error', error: { type: 'invalid_request_error', message } },
        message,
        headers,
      );
    expect(anthropicMap(gen(400, 'Your credit balance is too low to access the API'))).toMatchObject({
      reason: 'quota',
    });
    expect(anthropicMap(gen(400, 'max_tokens too large'))).toBeInstanceOf(NonRetryableAiError);
    expect(isProviderDown(anthropicMap(gen(400, 'max_tokens too large')))).toBe(false);
    expect(anthropicMap(gen(401, 'invalid x-api-key'))).toMatchObject({ reason: 'auth' });
    expect(anthropicMap(gen(529, 'Overloaded'))).toBeInstanceOf(ProviderOverloadedError);
    expect(anthropicMap(gen(429, 'rate'))).toBeInstanceOf(ProviderOverloadedError);
  });

  it('keeps quota and key problems non-retryable for the queue, overload retryable', () => {
    expect(new ProviderUnavailableError('x', 'quota')).toBeInstanceOf(NonRetryableAiError);
    expect(new ProviderOverloadedError('x', 'network')).not.toBeInstanceOf(NonRetryableAiError);
  });
});
