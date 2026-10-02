import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SECTION_GROUPS,
  BUSINESS_SECTION_META,
  BUSINESS_SECTION_SPEC,
  BusinessBuildResultSchema,
  BusinessSectionKey,
} from './business';
import {
  businessHealth,
  checkTerms,
  CreateBusinessFactSchema,
  isFactExpired,
  normalizeTermText,
  UpdateBusinessFactSchema,
  UpdateBusinessTermSchema,
  type HealthInput,
} from './business-profile';

describe('section registry', () => {
  it('describes and groups every section exactly once', () => {
    for (const key of BusinessSectionKey) {
      expect(BUSINESS_SECTION_SPEC[key]).toBeTruthy();
      expect(BUSINESS_SECTION_META[key]).toBeTruthy();
    }
    const grouped = BUSINESS_SECTION_GROUPS.flatMap((g) => g.keys);
    expect(grouped.sort()).toEqual([...BusinessSectionKey].sort());
  });

  it('keeps the original twelve keys first (stable prompt order)', () => {
    expect(BusinessSectionKey.slice(0, 3)).toEqual(['OVERVIEW', 'SERVICES', 'TARGET_MARKET']);
    expect(BusinessSectionKey.slice(-3)).toEqual(['GOALS', 'FAQ', 'CALENDAR']);
  });

  it('build results carry researched facts', () => {
    const r = BusinessBuildResultSchema.safeParse({
      name: 'ویپاد',
      tagline: '',
      industry: '',
      website: '',
      location: '',
      sections: [],
      facts: [{ label: 'سال', value: '۱۴۰۰', category: 'IDENTITY', sourceUrl: '' }],
      gaps: [],
    });
    expect(r.success).toBe(true);
  });
});

describe('terminology check', () => {
  const terms = [
    { id: 't1', term: 'ویپاد', kind: 'USE' as const, alternatives: ['وی پاد', 'WePod'], note: '' },
    {
      id: 't2',
      term: 'بانک ویپاد',
      kind: 'AVOID' as const,
      alternatives: ['شعبهٔ دیجیتال'],
      note: '',
    },
  ];

  it('normalizes Arabic letters, diacritics, ZWNJ and case', () => {
    expect(normalizeTermText('وي‌پاد')).toBe('وی پاد');
    expect(normalizeTermText('  WEPOD  ')).toBe('wepod');
    expect(normalizeTermText('كـتاب')).toBe('کتاب');
  });

  it('finds wrong variants of USE terms and AVOID terms as whole words', () => {
    const issues = checkTerms('با وی‌پاد و wepod؛ بانک ويپاد همراه توست.', terms);
    expect(issues.map((i) => [i.kind, i.found, i.count])).toEqual([
      ['USE', 'وی پاد', 1],
      ['USE', 'WePod', 1],
      ['AVOID', 'بانک ویپاد', 1],
    ]);
    expect(issues[2]!.replaceWith).toEqual(['شعبهٔ دیجیتال']);
  });

  it('does not match inside other words, and skips inactive rules', () => {
    expect(checkTerms('WePodcast', terms)).toEqual([]);
    expect(checkTerms('بانک ویپاد', [{ ...terms[1]!, isActive: false }])).toEqual([]);
    expect(checkTerms('ویپاد را درست نوشتیم', terms)).toEqual([]);
  });

  it('ignores a "wrong form" identical to the correct one', () => {
    const t = [{ term: 'ویپاد', kind: 'USE' as const, alternatives: ['ويپاد'], note: '' }];
    expect(checkTerms('ویپاد', t)).toEqual([]);
  });
});

describe('key facts', () => {
  it('validates the expiry date', () => {
    expect(
      CreateBusinessFactSchema.safeParse({ label: 'a', value: 'b', validUntil: '2026-13' }).success,
    ).toBe(false);
    expect(
      CreateBusinessFactSchema.parse({ label: 'a', value: 'b', validUntil: '2026-12-01' })
        .validUntil,
    ).toBe('2026-12-01');
  });

  it('a partial update does not reset other fields', () => {
    expect(UpdateBusinessFactSchema.parse({ verified: true })).toEqual({ verified: true });
    expect(UpdateBusinessTermSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it('expires after the given day', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(isFactExpired('2026-09-30', now)).toBe(false);
    expect(isFactExpired('2026-09-29', now)).toBe(true);
    expect(isFactExpired(null, now)).toBe(false);
  });
});

describe('profile health', () => {
  const full = (source: 'ADMIN' | 'AI', reviewed: boolean): HealthInput['sections'] =>
    BusinessSectionKey.map((key) => ({
      key,
      content: 'x'.repeat(BUSINESS_SECTION_META[key].minChars),
      source,
      reviewedAt: reviewed ? '2026-09-30T00:00:00Z' : null,
    }));
  const base: HealthInput = {
    sections: [],
    pendingSuggestions: 0,
    facts: [],
    terms: 0,
    assets: 0,
    gaps: 0,
    audit: null,
  };

  it('is 0 for an empty profile with core sections first', () => {
    const h = businessHealth(base);
    expect(h.score).toBe(0);
    expect(h.filled).toBe(0);
    expect(h.checks[0]!.id).toBe('CORE_SECTIONS');
    expect(h.checks[0]!.keys).toContain('OVERVIEW');
  });

  it('reaches 100 when everything is complete, reviewed and audited', () => {
    const h = businessHealth({
      ...base,
      sections: full('ADMIN', true),
      facts: [{ verified: true, isActive: true, validUntil: null }],
      terms: 3,
      assets: 2,
      audit: { open: 0, openHigh: 0 },
    });
    expect(h.score).toBe(100);
    expect(h.checks.every((c) => c.level === 'ok')).toBe(true);
  });

  it('discounts unreviewed AI text and flags it', () => {
    const reviewed = businessHealth({ ...base, sections: full('AI', true) });
    const draft = businessHealth({ ...base, sections: full('AI', false) });
    expect(draft.score).toBeLessThan(reviewed.score);
    const check = draft.checks.find((c) => c.id === 'UNREVIEWED')!;
    expect(check.level).toBe('warn');
    expect(check.count).toBe(BusinessSectionKey.length);
  });

  it('flags thin sections, expired and unverified facts, and open audit issues', () => {
    const h = businessHealth({
      ...base,
      sections: [{ key: 'OVERVIEW', content: 'short', source: 'ADMIN', reviewedAt: null }],
      facts: [
        { verified: false, isActive: true, validUntil: null },
        { verified: true, isActive: true, validUntil: '2020-01-01' },
      ],
      audit: { open: 2, openHigh: 1 },
      now: new Date('2026-09-30'),
    });
    const level = (id: string) => h.checks.find((c) => c.id === id)?.level;
    expect(level('THIN_SECTIONS')).toBe('warn');
    expect(level('UNVERIFIED_FACTS')).toBe('warn');
    expect(level('EXPIRED_FACTS')).toBe('warn');
    expect(level('AUDIT')).toBe('warn');
  });
});
