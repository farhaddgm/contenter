import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_TOLERANCE,
  MIN_STYLE_SAMPLES,
  assessStyleFit,
  styleStats,
  targetsFromInstagram,
  targetsFromTexts,
  type StyleTargets,
} from './style-fit';

// three fixed Persian samples: half-spaces, Persian digits, emoji, hashtags, a question, a CTA
const A =
  'قهوهٔ صبحگاهی را با ۲ قاشق شکر می‌نوشید؟ ☕\n\nما هر روز تازه‌ترین دانه‌ها را برای شما آسیاب می‌کنیم و در بسته‌های کوچک می‌فرستیم. همین حالا سفارش بدهید.\n\n#قهوه #صبحانه';
const B =
  'آیا می‌دانستید که آسیاب تازه طعم قهوه را کاملاً عوض می‌کند؟ ☕😍\n\nدانه‌های ما هر هفته برشته می‌شوند و در همان روز بسته‌بندی می‌شوند. برای سفارش دایرکت بدهید.\n\n#قهوه #آسیاب';
const C =
  'چای یا قهوه؟ هرکدام را که دوست دارید، تازه‌اش را بنوشید! ☕\n\nما هر دو را با دقت انتخاب می‌کنیم و سر وقت به دست شما می‌رسانیم. همین حالا ثبت‌نام کنید.\n\n#قهوه #چای';

describe('styleStats', () => {
  it('counts a Persian text with half-spaces, Persian digits, emoji and hashtags', () => {
    const s = styleStats(A);
    expect(s.hashtags).toBe(2);
    expect(s.emojis).toBe(1);
    expect(s.paragraphs).toBe(3);
    expect(s.question).toBe(true);
    expect(s.cta).toBe(true);
    expect(s.persianShare).toBeGreaterThan(0.95);
    expect(s.avgSentenceWords).toBeGreaterThan(5);
    expect(s.chars).toBe([...A.trim()].length);
  });

  it('the draft’s own call-to-action field counts, a repeated hashtag counts once, empty text is zeros', () => {
    expect(styleStats('یک متن ساده بدون هیچ دعوتی', 'همین حالا').cta).toBe(true);
    expect(styleStats('یک متن ساده بدون هیچ دعوتی').cta).toBe(false);
    expect(styleStats('متن #قهوه و دوباره #قهوه').hashtags).toBe(1);
    expect(styleStats('')).toMatchObject({
      chars: 0,
      hashtags: 0,
      emojis: 0,
      paragraphs: 0,
      question: false,
      cta: false,
    });
  });
});

describe('targetsFromTexts', () => {
  it('gives a range around the mean from three samples, and the share of examples with each flag', () => {
    const t = targetsFromTexts([A, B, C]) as StyleTargets;
    expect(t.source).toBe('SAMPLES');
    expect(t.basedOn).toBe(3);
    expect(t.numeric.hashtags).toEqual({ min: 1, max: 3, mean: 2 });
    expect(t.numeric.emojis!.mean).toBeCloseTo(1.33, 1);
    expect(t.numeric.chars!.min).toBeLessThan(t.numeric.chars!.mean);
    expect(t.numeric.chars!.max).toBeGreaterThan(t.numeric.chars!.mean);
    expect(t.flags).toEqual({ question: 1, cta: 1 });
    expect(t.numeric.persianShare!.max).toBeLessThanOrEqual(1);
  });

  it('says there are too few under three usable samples (short ones do not count)', () => {
    expect(targetsFromTexts([A, B])).toEqual({ tooFew: true, basedOn: 2 });
    expect(targetsFromTexts([A, B, 'سلام'])).toEqual({ tooFew: true, basedOn: 2 });
    expect(targetsFromTexts([])).toEqual({ tooFew: true, basedOn: 0 });
    expect(MIN_STYLE_SAMPLES).toBe(3);
  });
});

describe('assessStyleFit', () => {
  const targets = targetsFromTexts([A, B, C]) as StyleTargets;

  it('a draft like the samples is inside everywhere', () => {
    const draft = styleStats(
      'بهترین قهوه را از کجا بخریم؟ ☕\n\nدانه‌های تازه را هر هفته برشته می‌کنیم و برای شما می‌فرستیم. همین حالا سفارش بدهید.\n\n#قهوه #تازه',
    );
    const r = assessStyleFit(draft, targets);
    expect(r.rows.filter((x) => x.status !== 'inside')).toEqual([]);
    expect(r.inside).toBe(r.total);
    expect(r.basedOn).toBe(3);
  });

  it('a long, hashtag-free, question-free draft is flagged on the right side of each range', () => {
    const draft = styleStats('این یک متن بسیار طولانی است. '.repeat(40));
    const r = assessStyleFit(draft, targets);
    const by = Object.fromEntries(r.rows.map((x) => [x.metric, x.status]));
    expect(by.chars).toBe('above');
    expect(by.hashtags).toBe('below');
    expect(by.emojis).toBe('below');
    // every sample asks a question and has a CTA; this draft has neither
    expect(by.question).toBe('below');
    expect(by.cta).toBe('below');
    expect(r.inside).toBeLessThan(r.total);
  });

  it('a flag the examples do not settle never counts against the draft', () => {
    const mixed: StyleTargets = { ...targets, flags: { question: 0.5, cta: 0.1 } };
    const r = assessStyleFit(styleStats('بدون پرسش و بدون دعوت به کاری در این متن کوتاه'), mixed);
    expect(r.rows.find((x) => x.metric === 'question')).toMatchObject({ status: 'inside' });
    expect(r.rows.find((x) => x.metric === 'question')!.expected).toBeUndefined();
    // examples almost never use a CTA, so one in the draft is "above"
    const withCta = assessStyleFit(styleStats('این یک متن ساده است', 'همین حالا'), mixed);
    expect(withCta.rows.find((x) => x.metric === 'cta')).toMatchObject({
      status: 'above',
      expected: false,
    });
  });
});

describe('targetsFromInstagram', () => {
  const stats = {
    postsAnalyzed: 20,
    avgCaptionChars: 300,
    avgEmojisPerPost: 2,
    avgHashtagsPerPost: 6,
    scriptShare: { persian: 0.9, latin: 0.1 },
    ctaShare: 0.6,
    questionShare: 0.1,
  };

  it('turns averages into ranges ± half of the average, only for what the account’s numbers carry', () => {
    const t = targetsFromInstagram(stats) as StyleTargets;
    expect(t.source).toBe('INSTAGRAM');
    expect(t.numeric.chars).toEqual({ min: 150, max: 450, mean: 300 });
    expect(INSTAGRAM_TOLERANCE).toBe(0.5);
    expect(t.numeric.avgSentenceWords).toBeUndefined();
    expect(t.numeric.paragraphs).toBeUndefined();
    expect(t.numeric.persianShare!.mean).toBe(0.9);
    expect(t.numeric.persianShare!.max).toBeLessThanOrEqual(1);
    expect(t.flags).toEqual({ cta: 0.6, question: 0.1 });
    // rows are only made for the metrics that exist
    const r = assessStyleFit(styleStats(A), t);
    expect(r.rows.map((x) => x.metric).sort()).toEqual(
      ['chars', 'cta', 'emojis', 'hashtags', 'persianShare', 'question'].sort(),
    );
  });

  it('needs enough posts', () => {
    expect(targetsFromInstagram({ ...stats, postsAnalyzed: 3 })).toEqual({
      tooFew: true,
      basedOn: 3,
    });
  });
});
