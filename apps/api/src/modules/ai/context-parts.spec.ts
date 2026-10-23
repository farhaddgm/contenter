import { describe, expect, it } from 'vitest';
import {
  buildBusinessParts,
  formatBusiness,
  MAX_BUSINESS_TEXT,
  UNREVIEWED_MARK,
  type BusinessForPrompt,
} from './context';

const base: BusinessForPrompt = {
  name: 'Acme',
  tagline: 'Tea',
  industry: 'Food',
  website: '',
  location: '',
  language: 'fa',
  sections: [
    { key: 'OVERVIEW', content: 'We sell tea.' },
    { key: 'SERVICES', content: 'Black tea.\nGreen tea.', source: 'AI', reviewedAt: null },
  ],
};

const full: BusinessForPrompt = {
  ...base,
  facts: [{ label: 'Price', value: '100', category: 'PRICING', verified: true, validUntil: null }],
  terms: [{ term: 'Acme', kind: 'USE', alternatives: ['ACME'], note: '' }],
  assets: [{ kind: 'ARTICLE', title: 'Post', description: 'A note', analysis: null }],
  documents: [{ title: 'Doc', url: '', content: 'Document text.' }],
  examples: [{ platform: 'INSTAGRAM', format: 'POST', title: 'T', body: 'B', cta: '' }],
  style: { name: 'Warm', summary: 's', guide: 'Be warm.', traits: [] },
};

describe('buildBusinessParts', () => {
  it('is exactly what formatBusiness returns, joined by blank lines', () => {
    for (const b of [base, full, { ...full, facts: [], terms: [] }]) {
      for (const includeEmpty of [false, true]) {
        const parts = buildBusinessParts(b, { includeEmpty });
        expect(parts.map((p) => p.text).join('\n\n')).toBe(formatBusiness(b, { includeEmpty }));
      }
    }
  });

  it('does not change the prompt of a plain business', () => {
    expect(formatBusiness(base)).toBe(
      [
        'Name: Acme\nTagline: Tea\nIndustry: Food',
        '### Overview [OVERVIEW]\nWe sell tea.',
        `### Products & services [SERVICES] ${UNREVIEWED_MARK}\nBlack tea.\nGreen tea.`,
      ].join('\n\n'),
    );
  });

  it('lists the blocks in prompt order with their ids', () => {
    expect(buildBusinessParts(full).map((p) => p.id)).toEqual([
      'HEAD',
      'SECTION:OVERVIEW',
      'SECTION:SERVICES',
      'FACTS',
      'TERMS',
      'ASSETS',
      'DOCUMENTS',
      'EXAMPLES',
      'STYLE',
    ]);
  });

  it('counts characters per block and flags AI text nobody confirmed', () => {
    const parts = buildBusinessParts(base);
    for (const p of parts) expect(p.chars).toBe(p.text.length);
    expect(parts.find((p) => p.id === 'SECTION:SERVICES')?.unreviewed).toBe(true);
    expect(parts.find((p) => p.id === 'SECTION:OVERVIEW')?.unreviewed).toBe(false);
  });

  it('lists empty sections only when asked, without calling them cut', () => {
    expect(buildBusinessParts(base).some((p) => p.id === 'SECTION:PERSONAS')).toBe(false);
    const withEmpty = buildBusinessParts(base, { includeEmpty: true });
    const empty = withEmpty.find((p) => p.id === 'SECTION:PERSONAS');
    expect(empty?.text).toContain('(empty)');
    expect(empty?.cut).toBe(false);
  });

  it('marks a section cut at its cap, and sections left out when the budget is gone', () => {
    const long = { ...base, sections: [{ key: 'OVERVIEW' as const, content: 'a'.repeat(7000) }] };
    const [, overview] = buildBusinessParts(long);
    expect(overview?.cut).toBe(true);
    expect(overview?.text).toContain('[truncated]');

    const tight = buildBusinessParts(
      { ...base, sections: [{ key: 'OVERVIEW', content: 'one' }, { key: 'SERVICES', content: 'two' }] },
      { budget: 20 },
    );
    expect(tight.find((p) => p.id === 'SECTION:SERVICES')?.cut).toBe(true);
    expect(MAX_BUSINESS_TEXT).toBeGreaterThan(20);
  });

  it('reads "N more omitted" from a block whose budget ran out', () => {
    const facts = Array.from({ length: 200 }, (_, i) => ({
      label: `Fact ${i}`,
      value: `${'v'.repeat(60)} ${i}`,
      category: 'OTHER',
      verified: true,
      validUntil: null,
    }));
    const part = buildBusinessParts({ ...base, facts }).find((p) => p.id === 'FACTS');
    expect(part?.cut).toBe(true);
    expect(part?.omitted).toBeGreaterThan(0);
  });

  it('leaves out blocks that have nothing to say', () => {
    const ids = buildBusinessParts({ ...base, facts: [], terms: [], assets: [], documents: [] }).map((p) => p.id);
    expect(ids).toEqual(['HEAD', 'SECTION:OVERVIEW', 'SECTION:SERVICES']);
  });
});
