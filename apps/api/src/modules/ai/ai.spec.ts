import { describe, expect, it } from 'vitest';
import {
  ContentDraftResultSchema,
  IdeationResultSchema,
  ProfileBuildResultSchema,
  SampleAnalysisResultSchema,
  SmartReplySchema,
  type AiJobType,
} from '@contenter/shared';
import type { ZodType } from 'zod';
import { clamp, formatPrinciples, formatProfile, formatSample } from './context';
import { estimateCostUsd, priceFor } from './pricing';
import { DEFAULT_PROMPTS } from './prompts/defaults';
import { renderTemplate, templateVariables } from './prompts/render';
import { MockProvider } from './provider/mock.provider';

describe('renderTemplate', () => {
  it('replaces variables and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{ name }}, {{missing}}!', { name: 'Ali' })).toBe('Hi Ali, !');
  });
  it('lists variables', () => {
    expect(templateVariables('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b']);
  });
  it('every default prompt only uses documented variables', () => {
    const allowed: Record<string, string[]> = {
      analyze_sample: ['topic', 'sample', 'language'],
      build_profile: ['topic', 'analyses', 'principles', 'previous_profile', 'language'],
      ideate: [
        'topic',
        'profile',
        'principles',
        'existing_ideas',
        'count',
        'direction',
        'format',
        'language',
      ],
      generate_content: ['topic', 'profile', 'principles', 'idea', 'brief', 'format', 'language'],
      revise_content: ['topic', 'profile', 'principles', 'current_draft', 'feedback', 'language'],
      smart_chat: ['mode', 'context', 'transcript'],
    };
    for (const p of DEFAULT_PROMPTS) {
      const used = [...templateVariables(p.system), ...templateVariables(p.user)];
      for (const v of used) expect(allowed[p.key]).toContain(v);
    }
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
