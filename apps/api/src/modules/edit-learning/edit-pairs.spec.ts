import { describe, expect, it, vi } from 'vitest';
import type { EditLearningResult } from '@contenter/shared';
import {
  averageChange,
  buildPair,
  collectEditPairs,
  formatPairs,
  isNearDuplicate,
  resolveSuggestions,
  versionText,
  type EditPair,
  type VersionFields,
} from './edit-pairs';

const v = (version: number, body: string, over: Partial<VersionFields> = {}): VersionFields => ({
  version,
  title: 'عنوان',
  body,
  hashtags: [],
  cta: '',
  ...over,
});

const longBody = Array.from({ length: 40 }, (_, i) => `کلمه${i}`).join(' ');
/** Three words replaced: about 7 % of the words, a real edit. */
const edit = (text: string) =>
  text.replace('کلمه5', 'عبارت').replace('کلمه9', 'جمله').replace('کلمه20', 'واژه');

describe('buildPair', () => {
  it('compares title, body, hashtags and call to action together', () => {
    const ai = v(2, longBody, { hashtags: ['#الف'], cta: 'بخرید' });
    const final = v(3, longBody, { hashtags: ['#الف'], cta: 'همین امروز بخرید' });
    const pair = buildPair(0, { id: 'c1', title: 'T' }, ai, final);
    expect(pair).toMatchObject({ id: 'P1', contentId: 'c1', fromVersion: 2, toVersion: 3 });
    expect(pair.stats.addedWords).toBe(2);
    expect(pair.hunks[0]).toContain('{+همین امروز+}');
  });

  it('builds the text without empty parts', () => {
    expect(versionText(v(1, 'متن'))).toBe('عنوان\nمتن');
  });
});

describe('collectEditPairs', () => {
  const row = (
    id: string,
    aiBody: string,
    approvedBody: string,
    aiVersion = 1,
    approvedVersion = 2,
  ) => ({
    id,
    title: `محتوا ${id}`,
    currentVersion: { ...v(approvedVersion, approvedBody) },
    versions: [{ ...v(aiVersion, aiBody) }],
  });
  const prismaWith = (rows: unknown[]) => {
    const findMany = vi.fn(async () => rows);
    return { prisma: { content: { findMany } } as never, findMany };
  };

  it('asks only for approved contents whose approved text is an admin version of an AI draft', async () => {
    const { prisma, findMany } = prismaWith([]);
    await collectEditPairs(prisma, 't1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          topicId: 't1',
          status: 'APPROVED',
          currentVersion: { is: { source: 'ADMIN' } },
          versions: { some: { source: 'AI' } },
        },
      }),
    );
  });

  it('numbers the pairs from the newest and drops typo-sized edits', async () => {
    const edited = edit(longBody);
    const typo = `${longBody} `; // identical words
    const { prisma } = prismaWith([
      row('a', longBody, edited),
      row('b', longBody, typo),
      row('c', longBody, edited.replace('کلمه30', 'x')),
    ]);
    const pairs = await collectEditPairs(prisma, 't1');
    expect(pairs.map((p) => [p.id, p.contentId])).toEqual([
      ['P1', 'a'],
      ['P2', 'c'],
    ]);
  });

  it('ignores a content whose latest AI draft is newer than the approved text', async () => {
    const { prisma } = prismaWith([row('a', longBody, 'تغییر کامل متن', 5, 4)]);
    expect(await collectEditPairs(prisma, 't1')).toEqual([]);
  });

  it('stops at the limit', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`c${i}`, longBody, edit(longBody)));
    const { prisma } = prismaWith(rows);
    expect(await collectEditPairs(prisma, 't1', 4)).toHaveLength(4);
  });
});

const pair = (id: string, hunk = '{-الف-} {+ب+}', ratio = 0.1): EditPair => ({
  id,
  contentId: `c-${id}`,
  contentTitle: `عنوان ${id}`,
  fromVersion: 1,
  toVersion: 2,
  stats: {
    beforeWords: 10,
    afterWords: 10,
    removedWords: 1,
    addedWords: 1,
    changeRatio: ratio,
    lengthDeltaPct: -12,
  },
  hunks: [hunk],
});

describe('formatPairs', () => {
  it('writes each pair with its id, how much changed and the changed passages', () => {
    const text = formatPairs([pair('P1'), pair('P2')]);
    expect(text).toContain('<pair id="P1" title="عنوان P1" changed="10%" length="-12%">');
    expect(text).toContain('{-الف-} {+ب+}');
    expect(text.match(/<\/pair>/g)).toHaveLength(2);
  });

  it('says (none) without pairs and keeps to the budget', () => {
    expect(formatPairs([])).toBe('(none)');
    const big = pair('P1', 'x '.repeat(5000));
    expect(formatPairs([big, big, big], 1500).length).toBeLessThan(2500);
  });
});

describe('averageChange', () => {
  it('is the mean change ratio', () => {
    expect(averageChange([pair('P1', 'h', 0.1), pair('P2', 'h', 0.3)])).toBeCloseTo(0.2);
    expect(averageChange([])).toBe(0);
  });
});

describe('isNearDuplicate', () => {
  it('sees the same advice in the same words, ignoring letters variants and punctuation', () => {
    expect(isNearDuplicate('از جملات کوتاه استفاده کن.', 'از جملات كوتاه استفاده كن')).toBe(true);
  });
  it('sees mostly the same words as the same advice, and different advice as different', () => {
    expect(isNearDuplicate('همیشه مقدمه را کوتاه بنویس', 'مقدمه را کوتاه بنویس')).toBe(true);
    expect(isNearDuplicate('مقدمه را کوتاه بنویس', 'قیمت را در انتها بیاور')).toBe(false);
  });
});

describe('resolveSuggestions', () => {
  const pairs = [pair('P1'), pair('P2'), pair('P3')];
  const s = (over: Partial<EditLearningResult['suggestions'][number]> = {}) => ({
    kind: 'AVOID' as const,
    category: 'OPENING' as const,
    text: 'مقدمه را با احوال‌پرسی شروع نکن',
    rationale: 'در چند محتوا حذف شده',
    evidence: ['P1', 'P2'],
    ...over,
  });

  it('keeps a suggestion backed by two real pairs and rebuilds the evidence from them', () => {
    const [r] = resolveSuggestions({ suggestions: [s()] }, pairs, []);
    expect(r!.evidence.map((e) => e.contentId)).toEqual(['c-P1', 'c-P2']);
    expect(r!.evidence[0]).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      changeRatio: 0.1,
      excerpt: '{-الف-} {+ب+}',
    });
  });

  it('drops one pair of evidence: that is an anecdote, not a pattern', () => {
    expect(resolveSuggestions({ suggestions: [s({ evidence: ['P1'] })] }, pairs, [])).toEqual([]);
    expect(resolveSuggestions({ suggestions: [s({ evidence: ['P1', 'P1'] })] }, pairs, [])).toEqual(
      [],
    );
  });

  it('drops evidence the model made up', () => {
    expect(resolveSuggestions({ suggestions: [s({ evidence: ['P1', 'P9'] })] }, pairs, [])).toEqual(
      [],
    );
    const [r] = resolveSuggestions(
      { suggestions: [s({ evidence: ['P1', 'P9', 'P3'] })] },
      pairs,
      [],
    );
    expect(r!.evidence).toHaveLength(2);
  });

  it('drops what is already a principle, pending or dismissed, and repeats in the same answer', () => {
    const existing = ['مقدمه را با احوال‌پرسی شروع نکن'];
    expect(resolveSuggestions({ suggestions: [s()] }, pairs, existing)).toEqual([]);
    const twice = resolveSuggestions(
      { suggestions: [s(), s({ text: 'مقدمه را با احوال‌پرسی شروع نکن!' })] },
      pairs,
      [],
    );
    expect(twice).toHaveLength(1);
  });

  it('keeps at most five', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      s({ text: `قاعدهٔ کاملاً متفاوت شمارهٔ ${'الف'.repeat(i + 1)} برای نوشتن` }),
    );
    expect(resolveSuggestions({ suggestions: many }, pairs, []).length).toBeLessThanOrEqual(5);
  });
});
