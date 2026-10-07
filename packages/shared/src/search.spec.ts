import { describe, expect, it } from 'vitest';
import {
  countMatches,
  fold,
  highlightParts,
  makeSnippet,
  matchRanges,
  SEARCH_MAX_TERMS,
  SEARCH_MAX_VARIANTS,
  searchTerms,
  termVariants,
} from './search';
import {
  ContentListQuerySchema,
  IdeaListQuerySchema,
  RepurposeContentSchema,
  SearchQuerySchema,
} from './schemas';
import { defaultFormatFor, effectivePlatform } from './repurpose';

describe('fold', () => {
  it('treats the Arabic and Persian keyboards alike', () => {
    expect(fold('علي كتاب')).toBe(fold('علی کتاب'));
    expect(fold('مدينه')).toBe(fold('مدینه'));
  });

  it('treats the three digit scripts alike', () => {
    expect(fold('۱۲۳')).toBe('123');
    expect(fold('١٢٣')).toBe('123');
    expect(fold('عدد ۴۵')).toBe('عدد 45');
  });

  it('reads a half-space like a space and ignores case', () => {
    expect(fold('می‌کنه')).toBe(fold('می کنه'));
    expect(fold('Instagram')).toBe('instagram');
  });

  it('keeps every position, so a match maps back to the original text', () => {
    for (const text of ['علي‌ كتاب ۱۲۳', 'Hello World', 'می‌خوام']) {
      expect([...fold(text)]).toHaveLength([...text].length);
    }
  });
});

describe('searchTerms', () => {
  it('splits on whitespace and drops the punctuation around words', () => {
    expect(searchTerms('  «سرمایه‌گذاری»،   تازه‌کار؟ ')).toEqual(['سرمایه‌گذاری', 'تازه‌کار']);
  });

  it('drops a repeated word, even in another keyboard spelling', () => {
    expect(searchTerms('علی علي Ali ali')).toEqual(['علی', 'Ali']);
  });

  it('keeps only the first few words', () => {
    expect(searchTerms('a b c d e f g')).toHaveLength(SEARCH_MAX_TERMS);
  });

  it('is empty for nothing but punctuation', () => {
    expect(searchTerms(' ?! ')).toEqual([]);
  });
});

describe('termVariants', () => {
  it('offers both spellings of ی and ک', () => {
    expect(termVariants('علی')).toEqual(expect.arrayContaining(['علی', 'علي']));
    expect(termVariants('کتاب')).toEqual(expect.arrayContaining(['کتاب', 'كتاب']));
    expect(termVariants('کیف')).toHaveLength(4);
  });

  it('offers every digit script', () => {
    expect(termVariants('۱۲۳')).toEqual(expect.arrayContaining(['۱۲۳', '123', '١٢٣']));
    expect(termVariants('123')).toEqual(expect.arrayContaining(['123', '۱۲۳', '١٢٣']));
  });

  it('offers the space spelling of a half-space', () => {
    expect(termVariants('می‌کنه')).toContain('می کنه');
  });

  it('leaves a plain Latin word alone', () => {
    expect(termVariants('abc')).toEqual(['abc']);
  });

  it('never asks the database for more than a handful of spellings', () => {
    expect(termVariants('کیکي۱۲۳').length).toBeLessThanOrEqual(SEARCH_MAX_VARIANTS);
  });
});

describe('matchRanges / countMatches', () => {
  it('finds a term typed on the other keyboard', () => {
    const text = 'نظر علی درباره کتاب';
    expect(matchRanges(text, ['علي', 'كتاب'])).toEqual([
      [4, 7],
      [15, 19],
    ]);
    expect(countMatches(text, ['علي'])).toBe(1);
  });

  it('merges overlapping matches', () => {
    expect(matchRanges('سرمایه‌گذاری', ['سرمایه', 'مایه‌گ'])).toEqual([[0, 8]]);
  });

  it('finds nothing for a term that is not there', () => {
    expect(matchRanges('متن', ['دیگر'])).toEqual([]);
  });
});

describe('makeSnippet', () => {
  const long = `${'این یک متن بلند است '.repeat(12)}سرمایه‌گذاری هوشمند ${'و ادامهٔ متن '.repeat(12)}`;

  it('cuts around the first match and marks the cuts', () => {
    const snippet = makeSnippet(long, ['سرمایه‌گذاری'], 40);
    expect(snippet).toContain('سرمایه‌گذاری');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(120);
  });

  it('does not cut inside a word', () => {
    const snippet = makeSnippet(long, ['هوشمند'], 25).replaceAll('…', '').trim();
    for (const word of snippet.split(' ')) expect(long).toContain(word);
  });

  it('returns a short text whole, without dots', () => {
    expect(makeSnippet('سرمایه‌گذاری برای تازه‌کارها', ['تازه'], 70)).toBe(
      'سرمایه‌گذاری برای تازه‌کارها',
    );
  });

  it('collapses line breaks and is empty without a match', () => {
    expect(makeSnippet('یک\n\nدو   سه', ['دو'])).toBe('یک دو سه');
    expect(makeSnippet('متن', ['دیگر'])).toBe('');
  });
});

describe('highlightParts', () => {
  it('splits a text into plain and matching pieces that add up to the original', () => {
    const text = 'سرمایه‌گذاری برای تازه‌کارها، سرمایه!';
    const parts = highlightParts(text, ['سرمایه']);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['سرمایه', 'سرمایه']);
  });

  it('is one plain piece when nothing matches', () => {
    expect(highlightParts('متن', ['x'])).toEqual([{ text: 'متن', match: false }]);
  });
});

describe('list and search schemas', () => {
  it('reads comma-separated filters as lists', () => {
    const q = ContentListQuerySchema.parse({
      statuses: 'DRAFT, APPROVED',
      formats: 'POST,THREAD',
      platforms: 'INSTAGRAM',
      tagIds: 'a,b,,c',
    });
    expect(q.statuses).toEqual(['DRAFT', 'APPROVED']);
    expect(q.formats).toEqual(['POST', 'THREAD']);
    expect(q.platforms).toEqual(['INSTAGRAM']);
    expect(q.tagIds).toEqual(['a', 'b', 'c']);
  });

  it('refuses a value that is not in the enum, and a list that is too long', () => {
    expect(ContentListQuerySchema.safeParse({ statuses: 'DRAFT,NOPE' }).success).toBe(false);
    expect(
      ContentListQuerySchema.safeParse({ tagIds: Array(21).fill('x').join(',') }).success,
    ).toBe(false);
  });

  it('defaults to the most recently changed first and keeps old single filters working', () => {
    const q = ContentListQuerySchema.parse({ status: 'DRAFT', tagId: 't1', page: '2' });
    expect(q).toMatchObject({
      sort: 'updated',
      order: 'desc',
      status: 'DRAFT',
      tagId: 't1',
      page: 2,
    });
    expect(ContentListQuerySchema.safeParse({ sort: 'price' }).success).toBe(false);
    expect(ContentListQuerySchema.safeParse({ schedule: 'overdue' }).success).toBe(true);
    expect(ContentListQuerySchema.safeParse({ schedule: 'soon' }).success).toBe(false);
  });

  it('takes ISO dates for the created range', () => {
    expect(
      ContentListQuerySchema.safeParse({ createdFrom: '2026-10-01T00:00:00.000Z' }).success,
    ).toBe(true);
    expect(ContentListQuerySchema.safeParse({ createdFrom: 'yesterday' }).success).toBe(false);
  });

  it('filters ideas by several statuses and formats', () => {
    const q = IdeaListQuerySchema.parse({ statuses: 'PROPOSED,SHORTLISTED', formats: 'POST' });
    expect(q.statuses).toEqual(['PROPOSED', 'SHORTLISTED']);
    expect(q.sort).toBe('newest');
  });

  it('wants at least two characters to search', () => {
    expect(SearchQuerySchema.safeParse({ q: 'ا' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(SearchQuerySchema.parse({ q: 'سرمایه', limit: '5' })).toMatchObject({ limit: 5 });
    expect(SearchQuerySchema.parse({ q: 'سرمایه' }).limit).toBe(8);
  });
});

describe('repurposing', () => {
  it('picks the usual format of a platform', () => {
    expect(defaultFormatFor('X')).toBe('THREAD');
    expect(defaultFormatFor('LINKEDIN')).toBe('ARTICLE');
    expect(defaultFormatFor('INSTAGRAM')).toBe('CAROUSEL');
  });

  it('reads the platform a content was made for, else its topic’s', () => {
    expect(effectivePlatform({ platform: 'X' }, { platform: 'INSTAGRAM' })).toBe('X');
    expect(effectivePlatform({ platform: null }, { platform: 'INSTAGRAM' })).toBe('INSTAGRAM');
  });

  it('wants one to six targets, each listed once', () => {
    const t = (platform: string, format?: string) => ({ platform, format });
    expect(RepurposeContentSchema.safeParse({ targets: [] }).success).toBe(false);
    expect(RepurposeContentSchema.safeParse({ targets: [t('X')] }).success).toBe(true);
    expect(RepurposeContentSchema.safeParse({ targets: [t('X'), t('X')] }).success).toBe(false);
    // the same platform in two formats is two different pieces
    expect(
      RepurposeContentSchema.safeParse({ targets: [t('X', 'THREAD'), t('X', 'POST')] }).success,
    ).toBe(true);
    expect(
      RepurposeContentSchema.safeParse({
        targets: ['INSTAGRAM', 'YOUTUBE', 'TELEGRAM', 'LINKEDIN', 'X', 'TIKTOK', 'BLOG'].map((p) =>
          t(p),
        ),
      }).success,
    ).toBe(false);
    expect(RepurposeContentSchema.safeParse({ targets: [t('FACEBOOK')] }).success).toBe(false);
  });

  it('defaults the notes to nothing', () => {
    expect(RepurposeContentSchema.parse({ targets: [{ platform: 'X' }] }).notes).toBe('');
  });
});
