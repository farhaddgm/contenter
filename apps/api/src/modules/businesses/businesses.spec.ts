import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  BusinessBuildResultSchema,
  BusinessDiscoveryResultSchema,
  BusinessSectionKey,
  BusinessSuggestResultSchema,
  isSourceBlocked,
  sourceBlockValue,
  type AiJobType,
} from '@contenter/shared';
import type { ZodType } from 'zod';
import { appendMissingBlocks } from '../ai/ai-executor.service';
import { formatBusiness, formatSectionSpec, formatTopic, NO_BUSINESS } from '../ai/context';
import { estimateCostUsd } from '../ai/pricing';
import { DEFAULT_PROMPTS } from '../ai/prompts/defaults';
import { templateVariables } from '../ai/prompts/render';
import { mergeSources, researchSources, sumUsage } from '../ai/provider/ai-provider';
import { collectResearch, webSearchToolType } from '../ai/provider/anthropic.provider';
import { MockProvider } from '../ai/provider/mock.provider';
import { blocklistNote, filterSources, searchToolBlocklist } from '../ai/source-blocklist';
import { toStrictJsonSchema } from '../ai/provider/openai.provider';
import { cleanUrl } from './section-writer';

const business = {
  name: 'ویپاد',
  tagline: 'پرداخت آسان',
  industry: 'فین‌تک',
  website: 'https://example.com',
  location: 'تهران',
  language: 'fa',
  sections: [
    { key: 'SERVICES' as const, content: '- کیف پول' },
    { key: 'OVERVIEW' as const, content: 'یک شرکت پرداخت.' },
    { key: 'PERSONAS' as const, content: '   ' },
  ],
};

describe('business context', () => {
  it('formats filled sections in the canonical order and skips empty ones', () => {
    const out = formatBusiness(business);
    expect(out.startsWith('Name: ویپاد\nTagline: پرداخت آسان')).toBe(true);
    expect(out.indexOf('[OVERVIEW]')).toBeLessThan(out.indexOf('[SERVICES]'));
    expect(out).not.toContain('[PERSONAS]');
    expect(formatBusiness(null)).toBe(NO_BUSINESS);
  });

  it('lists empty sections when asked (for suggestions)', () => {
    const out = formatBusiness(business, { includeEmpty: true });
    expect(out).toContain('[PERSONAS]\n(empty)');
    expect(out).toContain('[BRAND_BOOK]\n(empty)');
  });

  it('keeps the whole profile within the budget', () => {
    const long = {
      ...business,
      sections: BusinessSectionKey.map((key) => ({ key, content: 'x'.repeat(10_000) })),
    };
    const out = formatBusiness(long, { budget: 15_000 });
    expect(out).toContain('[truncated]');
    expect(out).toContain('[omitted — business profile budget exhausted]');
    expect(out.length).toBeLessThan(16_000);
  });

  it('names the business in the topic block', () => {
    const topic = {
      title: 'T',
      description: 'D',
      audience: '',
      platform: 'INSTAGRAM' as const,
      language: 'fa',
    };
    expect(formatTopic({ ...topic, business: { name: 'ویپاد' } })).toContain('Business: ویپاد');
    expect(formatTopic(topic)).not.toContain('Business:');
  });

  it('describes every requested section', () => {
    expect(formatSectionSpec(['PERSONAS']).split('\n')).toHaveLength(1);
    expect(formatSectionSpec().split('\n')).toHaveLength(BusinessSectionKey.length);
  });
});

describe('business prompts', () => {
  it('every topic AI prompt receives the business block', () => {
    for (const key of [
      'analyze_sample',
      'build_profile',
      'ideate',
      'generate_content',
      'revise_content',
    ]) {
      const p = DEFAULT_PROMPTS.find((d) => d.key === key)!;
      expect(templateVariables(p.user)).toContain('business');
    }
  });

  it('prepends the business block to admin-edited prompts that lack it', () => {
    const out = appendMissingBlocks('<topic>x</topic>', 'R', { business: 'Name: ویپاد' });
    expect(out).toBe('<business>\nName: ویپاد\n</business>\n\nR');
    expect(appendMissingBlocks('x', 'R', { business: NO_BUSINESS })).toBe('R');
  });
});

describe('web research helpers', () => {
  it('picks the Claude web search tool version by model', () => {
    expect(webSearchToolType('claude-opus-5')).toBe('web_search_20260209');
    expect(webSearchToolType('claude-sonnet-5')).toBe('web_search_20260209');
    expect(webSearchToolType('claude-haiku-4-5')).toBe('web_search_20250305');
  });

  it('keeps the final notes and lists only the sources the notes rely on', () => {
    const blocks = [
      { type: 'text', text: 'Let me search.', citations: null },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [
          {
            type: 'web_search_result',
            url: 'https://a.com',
            title: 'A',
            encrypted_content: '',
            page_age: null,
          },
          {
            type: 'web_search_result',
            url: 'https://unrelated.com/x',
            title: 'Seen but never used',
            encrypted_content: '',
            page_age: null,
          },
        ],
      },
      {
        type: 'text',
        text: 'Found A (https://a.com).',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://b.com',
            title: 'B',
            cited_text: '',
            encrypted_index: '',
          },
        ],
      },
      { type: 'text', text: ' More.', citations: null },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    const out = collectResearch(blocks);
    expect(out.text).toBe('Found A (https://a.com). More.');
    // cited (b) + named in the notes (a); the unused search hit is not a source
    expect(out.sources).toEqual([
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com', title: 'A' },
    ]);
    // nothing cited or named → the raw hits stand in
    expect(researchSources([], [{ url: 'https://c.com', title: 'C' }]).map((s) => s.url)).toEqual([
      'https://c.com',
    ]);
  });

  it('sums usage and de-duplicates sources', () => {
    const u = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      webSearches: 5,
    };
    expect(sumUsage(u, { ...u, webSearches: undefined })).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 6,
      cacheWriteTokens: 8,
      webSearches: 5,
    });
    expect(
      mergeSources([{ url: 'https://a.com', title: '' }], [{ url: 'https://a.com', title: 'A' }]),
    ).toEqual([{ url: 'https://a.com', title: 'https://a.com' }]);
  });

  it('charges web searches', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearches: 3,
    };
    expect(estimateCostUsd('claude-opus-5', usage)).toBeCloseTo(0.03, 6);
    expect(estimateCostUsd('mock/claude-opus-5', usage)).toBe(0);
  });

  it('cleans URLs from the model', () => {
    expect(cleanUrl('example.com')).toBe('https://example.com/');
    expect(cleanUrl(' https://a.ir/x ')).toBe('https://a.ir/x');
    expect(cleanUrl('javascript:alert(1)')).toBe('');
    expect(cleanUrl('')).toBe('');
  });
});

describe('business AI schemas', () => {
  it('are strict-output compatible (every object closed)', () => {
    for (const schema of [
      BusinessSuggestResultSchema,
      BusinessDiscoveryResultSchema,
      BusinessBuildResultSchema,
    ]) {
      const json = JSON.stringify(toStrictJsonSchema(schema));
      expect(json).toContain('"additionalProperties":false');
    }
  });

  const provider = new MockProvider();
  const cases: [AiJobType, ZodType<unknown>, string][] = [
    ['BUSINESS_DISCOVER', BusinessDiscoveryResultSchema, '<count>2</count>'],
    ['BUSINESS_BUILD', BusinessBuildResultSchema, '<business_name>ویپاد</business_name>'],
    [
      'BUSINESS_SUGGEST',
      BusinessSuggestResultSchema,
      '<requested_sections>\n- PERSONAS (x)\n- BRAND_BOOK (y)\n</requested_sections>',
    ],
  ];
  it.each(cases)('mock returns schema-valid output for %s', async (task, schema, user) => {
    const res = await provider.generateStructured({
      task,
      model: 'm',
      effort: 'low',
      system: 's',
      user,
      schema,
    });
    expect(schema.safeParse(res.data).success).toBe(true);
    if (task === 'BUSINESS_DISCOVER')
      expect((res.data as { candidates: unknown[] }).candidates).toHaveLength(2);
    if (task === 'BUSINESS_BUILD') expect((res.data as { name: string }).name).toBe('ویپاد');
    if (task === 'BUSINESS_SUGGEST') {
      expect(
        (res.data as { suggestions: { key: string }[] }).suggestions.map((s) => s.key),
      ).toEqual(['PERSONAS', 'BRAND_BOOK']);
    }
  });

  it('mock research returns notes and sources', async () => {
    const res = await provider.research({
      task: 'BUSINESS_BUILD',
      model: 'm',
      effort: 'low',
      system: 's',
      user: 'u',
      maxSearches: 3,
    });
    expect(res.text).toContain('mock');
    expect(res.sources.length).toBeGreaterThan(0);
  });
});

describe('research source blocklist', () => {
  const rules = [
    { kind: 'DOMAIN' as const, value: 'spam.com' },
    { kind: 'URL' as const, value: 'news.ir/article/12' },
    { kind: 'URL' as const, value: 'root.org' },
  ];

  it('normalizes block values', () => {
    expect(sourceBlockValue('https://www.Spam.com/a/b?x=1', 'DOMAIN')).toBe('spam.com');
    expect(sourceBlockValue('https://www.news.ir/article/12/?utm=1#top', 'URL')).toBe(
      'news.ir/article/12',
    );
    expect(sourceBlockValue('example.com', 'DOMAIN')).toBe('example.com');
    expect(sourceBlockValue('not a url', 'URL')).toBeNull();
    expect(sourceBlockValue('javascript:alert(1)', 'DOMAIN')).toBeNull();
  });

  it('matches whole sites with subdomains, and single pages exactly', () => {
    expect(isSourceBlocked('https://blog.spam.com/post', rules)).toBe(true);
    expect(isSourceBlocked('http://spam.com', rules)).toBe(true);
    expect(isSourceBlocked('https://notspam.com', rules)).toBe(false);
    expect(isSourceBlocked('https://news.ir/article/12/', rules)).toBe(true);
    expect(isSourceBlocked('https://news.ir/article/13', rules)).toBe(false);
    expect(isSourceBlocked('https://root.org/', rules)).toBe(true);
    expect(isSourceBlocked('https://root.org/other', rules)).toBe(false);
    expect(isSourceBlocked('https://spam.com', [])).toBe(false);
  });

  it('filters sources and builds the search-tool list and prompt note', () => {
    const sources = [
      { url: 'https://a.spam.com/x', title: 'A' },
      { url: 'https://ok.com', title: 'OK' },
    ];
    expect(filterSources(sources, rules)).toEqual([{ url: 'https://ok.com', title: 'OK' }]);
    // A site-root URL rule must not block the whole host at the vendor.
    expect(searchToolBlocklist(rules)).toEqual(['spam.com', 'news.ir/article/12']);
    expect(blocklistNote([])).toBe('');
    expect(blocklistNote(rules)).toContain('- spam.com (whole site');
  });
});
