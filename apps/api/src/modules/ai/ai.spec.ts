import { describe, expect, it } from 'vitest';
import {
  ContentDraftResultSchema,
  IdeationResultSchema,
  ProfileBuildResultSchema,
  SampleAnalysisResultSchema,
  SmartReplySchema,
  normalizeModelRef,
  parseModelRef,
  type AiJobType,
} from '@contenter/shared';
import type { ZodType } from 'zod';
import { appendMissingBlocks } from './ai-executor.service';
import { clamp, formatBrandDocs, formatPrinciples, formatProfile, formatSample } from './context';
import { estimateCostUsd, priceFor } from './pricing';
import { DEFAULT_PROMPTS } from './prompts/defaults';
import { renderTemplate, templateVariables } from './prompts/render';
import { MockProvider } from './provider/mock.provider';
import { isReasoningModel, OpenAiProvider, toStrictJsonSchema } from './provider/openai.provider';
import { AiProviderRegistry } from './provider/provider-registry';
import type { Env } from '../../config/env';

describe('renderTemplate', () => {
  it('replaces variables and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{ name }}, {{missing}}!', { name: 'Ali' })).toBe('Hi Ali, !');
  });
  it('lists variables', () => {
    expect(templateVariables('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b']);
  });
  it('every default prompt only uses documented variables', () => {
    const allowed: Record<string, string[]> = {
      analyze_sample: ['topic', 'business', 'sample', 'language'],
      build_profile: [
        'topic',
        'business',
        'analyses',
        'principles',
        'brand_docs',
        'previous_profile',
        'language',
      ],
      ideate: [
        'topic',
        'business',
        'profile',
        'principles',
        'brand_docs',
        'existing_ideas',
        'count',
        'direction',
        'format',
        'language',
      ],
      generate_content: [
        'topic',
        'business',
        'profile',
        'principles',
        'brand_docs',
        'idea',
        'brief',
        'format',
        'language',
      ],
      revise_content: [
        'topic',
        'business',
        'profile',
        'principles',
        'brand_docs',
        'current_draft',
        'feedback',
        'language',
      ],
      smart_chat: ['mode', 'context', 'transcript'],
      business_research: ['language', 'goal', 'business'],
      business_discover: ['language', 'count', 'keyword', 'location', 'notes', 'research'],
      business_build: [
        'language',
        'business_name',
        'sections_spec',
        'business',
        'instruction',
        'research',
      ],
      business_suggest: ['language', 'business', 'requested_sections', 'instruction', 'research'],
      business_revise: [
        'language',
        'sections_spec',
        'business',
        'gaps',
        'standing_notes',
        'research',
        'note',
      ],
      business_asset_analyze: [
        'language',
        'business',
        'kind',
        'title',
        'url',
        'images',
        'description',
        'text',
      ],
    };
    expect(Object.keys(allowed).sort()).toEqual(DEFAULT_PROMPTS.map((p) => p.key).sort());
    for (const p of DEFAULT_PROMPTS) {
      const used = [...templateVariables(p.system), ...templateVariables(p.user)];
      for (const v of used) expect(allowed[p.key]).toContain(v);
    }
  });
  it('brand documents reach every generative prompt', () => {
    for (const key of ['build_profile', 'ideate', 'generate_content', 'revise_content']) {
      const p = DEFAULT_PROMPTS.find((d) => d.key === key)!;
      expect(templateVariables(p.user)).toContain('brand_docs');
    }
  });
});

describe('appendMissingBlocks', () => {
  const vars = { brand_docs: '### Book (BRAND_BOOK)\nSay "ویپاد".' };
  it('prepends brand docs when an edited prompt lacks the placeholder', () => {
    const out = appendMissingBlocks('<topic>x</topic>', '<topic>x</topic>', vars);
    expect(out.startsWith('<brand_guidelines>\n### Book')).toBe(true);
    expect(out.endsWith('<topic>x</topic>')).toBe(true);
  });
  it('leaves templates that already use it, or empty context, untouched', () => {
    expect(appendMissingBlocks('{{brand_docs}}', 'R', vars)).toBe('R');
    expect(appendMissingBlocks('x', 'R', { brand_docs: '(none)' })).toBe('R');
  });
});

describe('pricing', () => {
  it('computes cost including cache reads', () => {
    const cost = estimateCostUsd('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(cost).toBeCloseTo(5 + 2.5 + 0.5, 5);
  });
  it('is zero for mock and unknown models', () => {
    const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCostUsd('mock/claude-opus-5', usage)).toBe(0);
    expect(estimateCostUsd('some-other-model', usage)).toBe(0);
  });
  it('prefers the most specific model key', () => {
    expect(priceFor('claude-opus-5-5')?.input).toBe(4);
  });
  it('prices OpenAI models, snapshots and refs without cache-write charges', () => {
    expect(priceFor('gpt-5-mini-2025-08-07')?.input).toBe(0.25);
    expect(priceFor('openai:gpt-5')?.input).toBe(1.25);
    expect(priceFor('gpt-5.4-mini')).toBeUndefined();
    const cost = estimateCostUsd('gpt-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(cost).toBeCloseTo(1.25 + 0.125, 5);
  });
});

describe('model references', () => {
  it('parses explicit and legacy references', () => {
    expect(parseModelRef('openai:gpt-5.4')).toEqual({ provider: 'openai', model: 'gpt-5.4' });
    expect(parseModelRef('claude-opus-5')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
    });
    expect(parseModelRef('o4-mini').provider).toBe('openai');
    expect(normalizeModelRef('gpt-5')).toBe('openai:gpt-5');
  });
  it('routes by provider, or everything to mock', () => {
    const env = { AI_PROVIDER: 'live', AI_REFUSAL_FALLBACK: false } as Env;
    const live = new AiProviderRegistry(env);
    expect(live.resolve('openai:gpt-5').provider.name).toBe('openai');
    expect(live.resolve('claude-sonnet-5').provider.name).toBe('anthropic');
    const mock = new AiProviderRegistry({ ...env, AI_PROVIDER: 'mock' });
    expect(mock.resolve('openai:gpt-5')).toMatchObject({ model: 'gpt-5' });
    expect(mock.resolve('openai:gpt-5').provider.name).toBe('mock');
  });
});

describe('OpenAI structured output schema', () => {
  it('closes every object and requires every property', () => {
    const json = toStrictJsonSchema(ContentDraftResultSchema) as {
      additionalProperties: boolean;
      required: string[];
      properties: { selfCheck: { additionalProperties: boolean; required: string[] } };
    };
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toContain('selfCheck');
    expect(json.properties.selfCheck.additionalProperties).toBe(false);
    expect(json.properties.selfCheck.required).toEqual(['score', 'principles', 'suggestions']);
    expect(JSON.stringify(json)).not.toContain('$schema');
  });
  it('knows which models take a reasoning effort', () => {
    expect(isReasoningModel('gpt-5.4-mini')).toBe(true);
    expect(isReasoningModel('o4-mini')).toBe(true);
    expect(isReasoningModel('gpt-4.1')).toBe(false);
    expect(isReasoningModel('gpt-5-chat-latest')).toBe(false);
  });
});

describe('context formatters', () => {
  it('formats principles with global marker', () => {
    const out = formatPrinciples([
      { kind: 'MUST', text: 'A', topicId: 't1' },
      { kind: 'AVOID', text: 'B', topicId: null },
    ]);
    expect(out).toBe('- [MUST] A\n- [AVOID · global] B');
    expect(formatPrinciples([])).toBe('(none)');
  });

  it('includes only approved traits in the profile', () => {
    const out = formatProfile({
      version: 2,
      summary: 'S',
      styleGuide: 'G',
      traits: [
        { category: 'TONE', name: 'Friendly', description: 'd1', status: 'APPROVED' },
        { category: 'HOOK', name: 'Question', description: 'd2', status: 'REJECTED' },
      ],
    });
    expect(out).toContain('Friendly');
    expect(out).not.toContain('Question');
  });

  it('prefers manual text and truncates long page text', () => {
    const out = formatSample({
      url: 'https://a.com',
      platform: 'OTHER',
      mediaType: 'ARTICLE',
      manualText: 'MANUAL',
      adminNote: '',
      fetched: { text: 'x'.repeat(20_000), images: [] },
    });
    expect(out).toContain('MANUAL');
    expect(out.length).toBeLessThan(13_000);
  });

  it('formats brand documents within a total budget', () => {
    expect(formatBrandDocs([])).toBe('(none)');
    const out = formatBrandDocs(
      [
        { kind: 'BRAND_BOOK', title: 'A', content: 'a'.repeat(80) },
        { kind: 'WRITING_GUIDE', title: 'B', content: 'b'.repeat(80) },
        { kind: 'OTHER', title: 'C', content: 'c'.repeat(80) },
      ],
      100,
    );
    expect(out).toContain('### A (BRAND_BOOK)\n' + 'a'.repeat(80));
    expect(out).toContain('b'.repeat(20) + '\n[truncated]');
    expect(out).not.toContain('b'.repeat(21));
    expect(out).toContain('### C (OTHER)\n[omitted');
  });

  it('clamps', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});

describe('MockProvider', () => {
  const provider = new MockProvider();
  const cases: [AiJobType, ZodType<unknown>][] = [
    ['ANALYZE_SAMPLE', SampleAnalysisResultSchema],
    ['BUILD_PROFILE', ProfileBuildResultSchema],
    ['IDEATE', IdeationResultSchema],
    ['GENERATE_CONTENT', ContentDraftResultSchema],
    ['REVISE_CONTENT', ContentDraftResultSchema],
    ['SMART_CHAT', SmartReplySchema],
  ];
  it.each(cases)('returns schema-valid output for %s', async (task, schema) => {
    const res = await provider.generateStructured({
      task,
      model: 'claude-opus-5',
      effort: 'low',
      system: 's',
      user: '<count>4</count>',
      schema,
    });
    expect(schema.safeParse(res.data).success).toBe(true);
    if (task === 'IDEATE') expect((res.data as { ideas: unknown[] }).ideas).toHaveLength(4);
  });
});

describe('lastAdminMessage', () => {
  it('returns only the last admin message of a multi-turn transcript', async () => {
    const { lastAdminMessage } = await import('./provider/mock.provider');
    const transcript = [
      '<message role="admin">\nاین مرحله رو توضیح بده\n</message>',
      '<message role="assistant">\nپاسخ قبلی\n</message>',
      '<message role="admin">\nسؤال دوم\n</message>',
    ].join('\n');
    expect(lastAdminMessage(transcript)).toBe('سؤال دوم');
    expect(lastAdminMessage('no messages')).toBe('');
  });
});

describe('AnthropicProvider without credentials', () => {
  it('fails fast with a clear, non-retryable error', async () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    const { AnthropicProvider } = await import('./provider/anthropic.provider');
    const { NonRetryableAiError } = await import('./provider/ai-provider');
    const provider = new AnthropicProvider(undefined, true);
    await expect(
      provider.generateStructured({
        task: 'SMART_CHAT',
        model: 'claude-opus-5',
        effort: 'low',
        system: 's',
        user: 'u',
        schema: SmartReplySchema,
      }),
    ).rejects.toBeInstanceOf(NonRetryableAiError);
    if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  });
});

describe('OpenAiProvider without credentials', () => {
  it('fails fast with a clear, non-retryable error', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { NonRetryableAiError } = await import('./provider/ai-provider');
    const provider = new OpenAiProvider(undefined);
    expect(provider.configured).toBe(false);
    await expect(
      provider.generateStructured({
        task: 'SMART_CHAT',
        model: 'gpt-5',
        effort: 'low',
        system: 's',
        user: 'u',
        schema: SmartReplySchema,
      }),
    ).rejects.toBeInstanceOf(NonRetryableAiError);
    if (saved) process.env.OPENAI_API_KEY = saved;
  });
});
