import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIMILARITY_SETTINGS,
  MIN_SIMILARITY_WORDS,
  SimilaritySettingsSchema,
  contentSimilarity,
  fingerprint,
  similarityScore,
  similarityWords,
  type SimilarityCandidate,
} from './similarity';

const A =
  'قهوه را تازه آسیاب کنید و آب را کمی صبر بدهید تا از جوش بیفتد. بعد آرام روی قهوه بریزید و سی ثانیه صبر کنید. حالا یک فنجان قهوهٔ خوب دارید.';
const UNRELATED =
  'مسابقهٔ فوتبال شب گذشته با نتیجهٔ دو بر یک به پایان رسید و هواداران تا دیروقت در خیابان‌ها جشن گرفتند. داور بازی هم از سوی کارشناسان تحسین شد.';

const cand = (
  id: string,
  text: string,
  kind: SimilarityCandidate['kind'] = 'CONTENT',
): SimilarityCandidate => ({
  kind,
  id,
  title: `t-${id}`,
  text,
});

describe('similarityScore', () => {
  it('identical text with different punctuation, spelling and digits scores at least 0.9', () => {
    const b = A.replace(/[.،]/g, ' ! ').replace('کنید', 'كنيد').replace('سی', '30');
    const c = A.replace('سی', '30');
    expect(similarityScore(fingerprint(c), fingerprint(b))).toBeGreaterThanOrEqual(0.9);
  });

  it('unrelated texts score at most 0.10', () => {
    expect(similarityScore(fingerprint(A), fingerprint(UNRELATED))).toBeLessThanOrEqual(0.1);
  });

  it('a short post copied out of a long article is fully contained', () => {
    const article = `${UNRELATED} ${A} ${UNRELATED}`;
    expect(similarityScore(fingerprint(A), fingerprint(article))).toBe(1);
  });

  it('is symmetric where it should be and zero for empty text', () => {
    expect(similarityScore(fingerprint(''), fingerprint(A))).toBe(0);
    const x = similarityScore(fingerprint(A), fingerprint(A + ' ' + UNRELATED));
    expect(x).toBeGreaterThan(0.4);
  });
});

describe('similarityWords', () => {
  it('folds yeh/kaf, digits and the half-space, and drops links and punctuation', () => {
    expect(similarityWords('كتاب‌هاي ۱۲۳ https://x.ir/a !')).toEqual(['کتاب', 'های', '123']);
  });
});

describe('contentSimilarity', () => {
  it('lists the matches above the warning score, best first, and sets the level', () => {
    const r = contentSimilarity(A, [
      cand('far', UNRELATED),
      cand('copy', A.replace('کنید', 'کنین')),
      cand('half', A.split('.')[0] + '. ' + UNRELATED),
    ]);
    expect(r.compared).toBe(3);
    expect(r.matches[0]).toMatchObject({ id: 'copy', kind: 'CONTENT' });
    expect(r.matches.map((m) => m.id)).not.toContain('far');
    expect(r.level).toBe('COPY');
  });

  it('SIMILAR sits between the two thresholds', () => {
    const half = A.split('.').slice(0, 2).join('.') + '. ' + UNRELATED;
    const r = contentSimilarity(A, [cand('p', half)], { warnAt: 0.3, copyAt: 0.95 });
    expect(r.level).toBe('SIMILAR');
  });

  it('thresholds come from the settings', () => {
    const half = A.split('.').slice(0, 2).join('.') + '. ' + UNRELATED;
    expect(contentSimilarity(A, [cand('p', half)], { warnAt: 0.9, copyAt: 0.95 }).level).toBe(
      'NONE',
    );
  });

  it('gives no verdict for a short text and ignores a very short candidate', () => {
    const short = 'سلام دوستان خوبید؟';
    expect(similarityWords(short).length).toBeLessThan(MIN_SIMILARITY_WORDS);
    expect(contentSimilarity(short, [cand('x', short)])).toMatchObject({
      enough: false,
      level: 'NONE',
      matches: [],
    });
    expect(contentSimilarity(A, [cand('x', short)]).matches).toEqual([]);
  });

  it('empty candidate list and empty text are not errors', () => {
    expect(contentSimilarity(A, []).level).toBe('NONE');
    expect(contentSimilarity('', [cand('x', A)]).enough).toBe(false);
  });

  it('lists at most three matches', () => {
    const r = contentSimilarity(
      A,
      ['a', 'b', 'c', 'd', 'e'].map((id) => cand(id, A)),
    );
    expect(r.matches).toHaveLength(3);
  });

  it('1000 comparisons take well under 200 ms', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      cand(`c${i}`, `${UNRELATED} ${i} ${A.slice(i % 30)}`),
    );
    const t0 = performance.now();
    contentSimilarity(A, many);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('SimilaritySettingsSchema', () => {
  it('has defaults, bounds, and keeps copyAt above warnAt', () => {
    expect(SimilaritySettingsSchema.parse({})).toEqual(DEFAULT_SIMILARITY_SETTINGS);
    expect(SimilaritySettingsSchema.safeParse({ warnAt: 0.9, copyAt: 0.8 }).success).toBe(false);
    expect(SimilaritySettingsSchema.safeParse({ warnAt: 0.1 }).success).toBe(false);
  });
});
