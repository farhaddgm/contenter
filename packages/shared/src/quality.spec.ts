import { describe, expect, it } from 'vitest';
import {
  checkContentQuality,
  extractNumbers,
  hasMixedDigits,
  normalizeDigits,
  persianTypographyIssues,
  PLATFORM_RULES,
  threadPosts,
  type QualityInput,
} from './quality';
import { Platform } from './enums';

const base = (over: Partial<QualityInput> = {}): QualityInput => ({
  title: 'عنوان',
  body: 'متن کوتاه و درست.',
  hashtags: [],
  cta: '',
  platform: 'TELEGRAM',
  format: 'POST',
  ...over,
});

const codes = (i: QualityInput) => checkContentQuality(i).issues.map((x) => x.code);

describe('digits and numbers', () => {
  it('normalizes Persian and Arabic digits and separators', () => {
    expect(normalizeDigits('۱۲۳ ٤٥٦ 7')).toBe('123 456 7');
    expect(normalizeDigits('۱٬۲۰۰٫۵')).toBe('1,200.5');
  });

  it('extracts canonical numbers, with thousand separators and scale words', () => {
    expect(extractNumbers('قیمت ۵۰۰,۰۰۰ تومان')).toEqual(['500000']);
    expect(extractNumbers('قیمت ۵۰۰ هزار تومان').sort()).toEqual(['500', '500000']);
    expect(extractNumbers('۲٫۵ میلیون').sort()).toEqual(['2.5', '2500000']);
    expect(extractNumbers('تماس: ۰۲۱۱۲۳۴')).toEqual(['211234']);
    expect(extractNumbers('بدون عدد')).toEqual([]);
  });
});

describe('platform limits', () => {
  it('has a rule entry for every platform', () => {
    for (const p of Platform) expect(PLATFORM_RULES[p]).toBeDefined();
  });

  it('flags a text over the platform limit, counting body, call to action and hashtags', () => {
    const report = checkContentQuality(
      base({ platform: 'INSTAGRAM', format: 'CAPTION', body: 'ا'.repeat(2190), cta: 'بخرید', hashtags: ['a', 'b'] }),
    );
    const issue = report.issues.find((i) => i.code === 'LENGTH_OVER');
    expect(issue?.params).toMatchObject({ max: 2200 });
    expect(issue?.params.over).toBeGreaterThan(0);
  });

  it('accepts a text exactly at the limit', () => {
    const r = checkContentQuality(base({ platform: 'X', format: 'POST', body: 'ا'.repeat(280) }));
    expect(r.issues.map((i) => i.code)).not.toContain('LENGTH_OVER');
    const over = checkContentQuality(base({ platform: 'X', format: 'POST', body: 'ا'.repeat(281) }));
    expect(over.issues.map((i) => i.code)).toContain('LENGTH_OVER');
  });

  it('counts a hashtag once however often it is written', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(codes(base({ platform: 'INSTAGRAM', hashtags: tags }))).not.toContain('HASHTAGS_OVER');
    expect(codes(base({ platform: 'INSTAGRAM', hashtags: [...tags, '#extra'] }))).toContain(
      'HASHTAGS_OVER',
    );
    expect(codes(base({ platform: 'INSTAGRAM', hashtags: ['a', '#a', 'a'] }))).not.toContain(
      'HASHTAGS_OVER',
    );
  });

  it('checks every post of a thread on its own', () => {
    const body = ['پست اول', 'ب'.repeat(300), 'پست سوم'].join('\n\n');
    const r = checkContentQuality(base({ platform: 'X', format: 'THREAD', body }));
    const over = r.issues.filter((i) => i.code === 'THREAD_POST_OVER');
    expect(over).toHaveLength(1);
    expect(over[0].params).toMatchObject({ post: 2, max: 280 });
    expect(r.issues.map((i) => i.code)).not.toContain('LENGTH_OVER');
    expect(threadPosts('a\n\nb\n---\nc')).toEqual(['a', 'b', 'c']);
  });

  it('does not check a platform without a known limit', () => {
    expect(codes(base({ platform: 'EITAA', body: 'ا'.repeat(100_000) }))).not.toContain(
      'LENGTH_OVER',
    );
  });

  it('flags an empty body', () => {
    expect(codes(base({ body: '   ' }))).toContain('EMPTY_BODY');
  });
});

describe('brand terminology', () => {
  it('reports an AVOID term and a wrong spelling of a USE term', () => {
    const r = checkContentQuality(
      base({
        body: 'ما ارزان‌ترین هستیم و ویپاد می‌فروشیم.',
        terms: [
          { term: 'ارزان‌ترین', kind: 'AVOID', alternatives: ['مقرون‌به‌صرفه'], note: '' },
          { term: 'وی‌پاد', kind: 'USE', alternatives: ['ویپاد'], note: '' },
        ],
      }),
    );
    expect(r.issues.map((i) => i.code).sort()).toEqual(['TERM_AVOID', 'TERM_USE']);
  });
});

describe('key facts', () => {
  const fact = { label: 'قیمت اشتراک ماهانه', value: '۵۰۰ هزار تومان' };

  it('flags a sentence about a fact that quotes a different number', () => {
    const r = checkContentQuality(base({ body: 'قیمت اشتراک ماهانه ۴۰۰ هزار تومان است.', facts: [fact] }));
    const issue = r.issues.find((i) => i.code === 'FACT_NUMBER_MISMATCH');
    expect(issue).toBeDefined();
    expect(issue?.params).toMatchObject({ label: fact.label, expected: fact.value });
  });

  it('accepts the number written in another script, with separators or a scale word', () => {
    for (const body of [
      'قیمت اشتراک ماهانه 500 هزار تومان است.',
      'قیمت اشتراک ماهانه ۵۰۰٬۰۰۰ تومان است.',
      'قیمت اشتراک ماهانه ۵۰۰,۰۰۰ تومان است.',
    ]) {
      expect(codes(base({ body, facts: [fact] }))).not.toContain('FACT_NUMBER_MISMATCH');
    }
  });

  it('is silent when the sentence has no number or does not talk about the fact', () => {
    expect(codes(base({ body: 'اشتراک ماهانه ما ارزان است.', facts: [fact] }))).toEqual([]);
    expect(codes(base({ body: 'ما ۴۰۰ شعبه داریم.', facts: [fact] }))).toEqual([]);
  });

  it('matches a label whose words are in another order', () => {
    expect(
      codes(base({ body: 'اشتراک ماهانه با قیمت ۳۰۰ هزار تومان عرضه می‌شود.', facts: [fact] })),
    ).toContain('FACT_NUMBER_MISMATCH');
  });

  it('flags a fact that has expired and ignores an inactive one', () => {
    const expired = { ...fact, validUntil: '2026-01-01' };
    const now = new Date('2026-10-13T00:00:00Z');
    const r = checkContentQuality(
      base({ body: 'قیمت اشتراک ماهانه ۵۰۰ هزار تومان است.', facts: [expired], now }),
    );
    expect(r.issues.find((i) => i.code === 'FACT_EXPIRED')?.params).toMatchObject({
      validUntil: '2026-01-01',
    });
    const off = checkContentQuality(
      base({
        body: 'قیمت اشتراک ماهانه ۵۰۰ هزار تومان است.',
        facts: [{ ...expired, isActive: false }],
        now,
      }),
    );
    expect(off.issues).toEqual([]);
    const valid = checkContentQuality(
      base({
        body: 'قیمت اشتراک ماهانه ۵۰۰ هزار تومان است.',
        facts: [{ ...fact, validUntil: '2027-01-01' }],
        now,
      }),
    );
    expect(valid.issues).toEqual([]);
  });
});

describe('Persian typography', () => {
  it('finds a missing half-space after می/نمی and before plural and comparative suffixes', () => {
    const found = persianTypographyIssues('ما می کنیم و نمی خواهیم. کتاب ها بزرگ تر هستند.');
    expect(found.filter((i) => i.kind === 'HALF_SPACE')).toHaveLength(4);
    expect(found.every((i) => i.replacement === '‌')).toBe(true);
  });

  it('leaves correct text and longer words alone', () => {
    expect(persianTypographyIssues('می‌کنیم، کتاب‌ها، بزرگ‌تر. او اسلامی است و می‌داند.')).toEqual([]);
  });

  it('finds Arabic letters and Latin punctuation, with the replacement', () => {
    const found = persianTypographyIssues('كتاب علي, خوب است؟');
    expect(found.filter((i) => i.kind === 'ARABIC_LETTER').map((i) => i.replacement)).toEqual([
      'ک',
      'ی',
    ]);
    expect(found.find((i) => i.kind === 'LATIN_PUNCTUATION')?.replacement).toBe('،');
  });

  it('finds a space before punctuation and double spaces', () => {
    const kinds = persianTypographyIssues('سلام ، دوست  من !').map((i) => i.kind);
    expect(kinds).toContain('SPACE_BEFORE_PUNCTUATION');
    expect(kinds).toContain('DOUBLE_SPACE');
  });

  it('skips URLs, hashtags, mentions and code', () => {
    const text = 'متن خوب است. https://a.ir/می?x=1 #می_کنم @می‌کنم `می کنم`';
    expect(persianTypographyIssues(text)).toEqual([]);
  });

  it('does not apply to a text that is not Persian', () => {
    expect(persianTypographyIssues('We do it , really  fine ?')).toEqual([]);
    expect(codes(base({ body: 'Hello there , friends  .' }))).toEqual([]);
  });

  it('detects mixed digit scripts but not codes like 4K', () => {
    expect(hasMixedDigits('سه ۳ روز و 5 ساعت')).toBe(true);
    expect(hasMixedDigits('فقط ۳ روز و ۵ ساعت')).toBe(false);
    expect(hasMixedDigits('فقط 3 روز و 5 ساعت')).toBe(false);
    expect(hasMixedDigits('ویدیو 4K و ۳ روز')).toBe(false);
    expect(codes(base({ body: 'سه ۳ روز و 5 ساعت.' }))).toContain('DIGITS_MIXED');
  });

  it('reports typography as information, not as a warning', () => {
    const r = checkContentQuality(base({ body: 'ما می کنیم.' }));
    expect(r.issues.every((i) => i.severity === 'info')).toBe(true);
    expect(r.warnings).toBe(0);
  });
});

describe('placeholders', () => {
  it.each(['[نام مشتری] عزیز', 'متن lorem ipsum dolor', 'TODO: قیمت را بنویس', 'سلام {{name}}'])(
    'flags %s',
    (body) => {
      expect(codes(base({ body }))).toContain('PLACEHOLDER');
    },
  );

  it('does not flag ordinary brackets', () => {
    expect(codes(base({ body: 'مدل [الف] و (ب) ارائه می‌شود.' }))).not.toContain('PLACEHOLDER');
  });
});

describe('report', () => {
  it('is deterministic and returns the rules used', () => {
    const input = base({ platform: 'BALE', body: 'ما می کنیم.' });
    const a = checkContentQuality(input);
    expect(checkContentQuality(input)).toEqual(a);
    expect(a.rules.confidence).toBe('official');
    expect(a.length).toBeGreaterThan(0);
  });
});
