import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STIFF_PHRASES,
  LONG_SENTENCE_WORDS,
  MIN_READABILITY_WORDS,
  ReadabilitySettingsSchema,
  analyzeReadability,
} from './readability';

const codes = (r: ReturnType<typeof analyzeReadability>) => r.notes.map((n) => n.code);

const SIMPLE =
  'قهوه را تازه آسیاب کنید. آب را کمی صبر بدهید تا از جوش بیفتد. بعد آرام روی قهوه بریزید. ' +
  'سی ثانیه صبر کنید. حالا یک فنجان قهوهٔ خوب دارید. از آن لذت ببرید و برای ما بنویسید.';

describe('analyzeReadability', () => {
  it('a simple, short-sentence text gets no note', () => {
    const r = analyzeReadability({ body: SIMPLE, platform: 'INSTAGRAM' });
    expect(r.enough).toBe(true);
    expect(r.notes).toEqual([]);
    expect(r.metrics.sentences).toBe(6);
    expect(r.metrics.avgSentenceWords).toBeLessThan(10);
    expect(r.metrics.longSentenceShare).toBe(0);
  });

  it('flags a long mean sentence and long sentences', () => {
    const long = Array.from({ length: LONG_SENTENCE_WORDS + 6 }, () => 'کلمه').join(' ') + '.';
    const r = analyzeReadability({ body: `${long} ${long}`, platform: 'INSTAGRAM' });
    expect(codes(r)).toEqual(['SENTENCES_LONG_AVG', 'SENTENCES_LONG_SHARE']);
    expect(r.notes[1]!.params).toMatchObject({ count: 2, total: 2 });
  });

  it('the same text is judged by the limit of its platform', () => {
    const sentence = Array.from({ length: 22 }, () => 'کلمه').join(' ') + '.';
    const body = `${sentence} ${sentence}`;
    expect(codes(analyzeReadability({ body, platform: 'X' }))).toContain('SENTENCES_LONG_AVG');
    expect(codes(analyzeReadability({ body, platform: 'BLOG' }))).not.toContain('SENTENCES_LONG_AVG');
  });

  it('the admin limit replaces the table without a deploy', () => {
    const sentence = Array.from({ length: 22 }, () => 'کلمه').join(' ') + '.';
    const body = `${sentence} ${sentence}`;
    const strict = analyzeReadability({ body, platform: 'BLOG', settings: { maxAvgSentenceWords: 10 } });
    expect(codes(strict)).toContain('SENTENCES_LONG_AVG');
    expect(strict.limits.avgSentenceWords).toBe(10);
  });

  it('finds stiff, translated-sounding phrases (half-space or not) and counts the longest once', () => {
    const body =
      'در جهت بهبود کیفیت محصولات ما به منظور آنکه مشتری راضی باشد تلاش کردیم. ' +
      'این محصول مورد استفاده قرار می‌گیرد و پشتیبانی آن توسط تیم ما انجام می‌شود. ' +
      'ما هر روز کار می‌کنیم تا شما بهترین قهوه را بنوشید و لذت ببرید.';
    const r = analyzeReadability({ body, platform: 'BLOG' });
    const found = r.metrics.stiffPhrases.map((p) => p.phrase);
    expect(found).toContain('در جهت');
    expect(found).toContain('به منظور آنکه');
    expect(found).not.toContain('به منظور'); // already inside the longer phrase
    expect(found).toContain('توسط');
    expect(codes(r)).toContain('STIFF_PHRASES');
  });

  it('a single stiff phrase is not enough to flag', () => {
    const r = analyzeReadability({
      body: SIMPLE + ' در خصوص سفارش‌ها پیام بدهید.',
      platform: 'INSTAGRAM',
    });
    expect(r.metrics.stiffPhrases).toEqual([{ phrase: 'در خصوص', count: 1 }]);
    expect(codes(r)).not.toContain('STIFF_PHRASES');
  });

  it('phrases added by the admin are counted too', () => {
    const body = SIMPLE + ' راهکار نوین راهکار نوین ما همیشه کنار شماست.';
    const base = analyzeReadability({ body, platform: 'INSTAGRAM' });
    expect(codes(base)).not.toContain('STIFF_PHRASES');
    const withExtra = analyzeReadability({
      body,
      platform: 'INSTAGRAM',
      settings: { extraPhrases: ['راهکار نوین'] },
    });
    expect(withExtra.metrics.stiffPhrases).toEqual([{ phrase: 'راهکار نوین', count: 2 }]);
    expect(codes(withExtra)).toContain('STIFF_PHRASES');
  });

  it('flags a text full of Latin words but ignores hashtags, links and mentions', () => {
    const latin =
      'امروز brand new collection را launch کردیم و آن را با team و partners و customers به اشتراک گذاشتیم. ' +
      'لطفاً feedback خود را share کنید تا improve کنیم.';
    expect(codes(analyzeReadability({ body: latin, platform: 'INSTAGRAM' }))).toContain('LATIN_HEAVY');
    const r = analyzeReadability({
      body: SIMPLE + ' #coffee @cafe https://example.com/Some-Long-Path',
      platform: 'INSTAGRAM',
    });
    expect(r.metrics.latinShare).toBe(0);
  });

  it('a short text gets numbers but no verdict', () => {
    const r = analyzeReadability({ body: 'در جهت در جهت در خصوص در خصوص.', platform: 'X' });
    expect(r.metrics.words).toBeLessThan(MIN_READABILITY_WORDS);
    expect(r.enough).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it('empty and symbol-only input give zeros and no error', () => {
    for (const body of ['', '   \n  ', '😀😀 ... !!! 123']) {
      const r = analyzeReadability({ body, platform: 'OTHER' });
      expect(r.metrics).toMatchObject({ words: 0, sentences: 0, avgSentenceWords: 0, longSentenceShare: 0 });
      expect(r.notes).toEqual([]);
    }
  });

  it('is pure: the same input gives the same report', () => {
    const a = analyzeReadability({ body: SIMPLE, platform: 'TELEGRAM' });
    expect(analyzeReadability({ body: SIMPLE, platform: 'TELEGRAM' })).toEqual(a);
  });
});

describe('ReadabilitySettingsSchema', () => {
  it('fills defaults and bounds the values', () => {
    expect(ReadabilitySettingsSchema.parse({})).toEqual({ extraPhrases: [], maxAvgSentenceWords: null });
    expect(ReadabilitySettingsSchema.safeParse({ maxAvgSentenceWords: 2 }).success).toBe(false);
    expect(ReadabilitySettingsSchema.safeParse({ extraPhrases: ['x'] }).success).toBe(false);
    expect(ReadabilitySettingsSchema.parse({ extraPhrases: ['  راهکار نوین '] }).extraPhrases).toEqual([
      'راهکار نوین',
    ]);
  });

  it('the starting list is not empty', () => {
    expect(DEFAULT_STIFF_PHRASES.length).toBeGreaterThan(5);
  });
});
