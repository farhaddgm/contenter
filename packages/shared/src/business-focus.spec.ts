import { describe, expect, it } from 'vitest';
import { effectiveFocus, FocusFieldsSchema, focusAllowedIds } from './business-focus';
import { checkContentQuality, type QualityOfferingRule } from './quality';

describe('effectiveFocus', () => {
  it("takes the content's own choice first, and what it leaves empty from the project", () => {
    const topic = { offeringId: 'T-O', segmentId: 'T-S' };
    expect(effectiveFocus(null, topic)).toEqual({ offeringId: 'T-O', segmentId: 'T-S' });
    expect(effectiveFocus({ offeringId: 'C-O' }, topic)).toEqual({ offeringId: 'C-O', segmentId: 'T-S' });
    expect(effectiveFocus({ offeringId: null, segmentId: 'C-S' }, topic)).toEqual({
      offeringId: 'T-O',
      segmentId: 'C-S',
    });
    expect(effectiveFocus(undefined, {})).toEqual({ offeringId: null, segmentId: null });
  });

  it('the fields: null clears, absent leaves alone, empty text is refused', () => {
    expect(FocusFieldsSchema.parse({})).toEqual({});
    expect(FocusFieldsSchema.parse({ offeringId: null })).toEqual({ offeringId: null });
    expect(FocusFieldsSchema.safeParse({ segmentId: '' }).success).toBe(false);
  });
});

describe('focusAllowedIds', () => {
  const rows = [
    { id: 'L' },
    { id: 'P', parentId: 'L', complementIds: ['C'], substituteIds: ['S'] },
    { id: 'V', parentId: 'P' },
    { id: 'Q', parentId: 'L' },
    { id: 'C' },
    { id: 'S' },
    { id: 'X' },
  ];

  it('is the offering, its lines above, its variants below, and its complements and substitutes', () => {
    expect(focusAllowedIds('P', rows).sort()).toEqual(['C', 'L', 'P', 'S', 'V']);
  });

  it('leaves its siblings and unrelated offerings out', () => {
    const allowed = focusAllowedIds('P', rows);
    expect(allowed).not.toContain('Q');
    expect(allowed).not.toContain('X');
    expect(focusAllowedIds('L', rows).sort()).toEqual(['L', 'P', 'Q', 'V']);
  });
});

describe('OFFERING_CROSSED in the quality gate', () => {
  const rule = (over: Partial<QualityOfferingRule> & { id: string; name: string }): QualityOfferingRule => ({
    available: true,
    ...over,
  });
  const offerings: QualityOfferingRule[] = [
    rule({ id: 'F', name: 'تسهیلات تجهیزات', priceAmount: '10000000', priceCurrency: 'IRT', features: ['اقساط ۱۲ ماهه'] }),
    rule({
      id: 'O',
      name: 'تسهیلات مسکن',
      priceAmount: '50000000',
      priceCurrency: 'IRT',
      features: ['اقساط ۶۰ ماهه', 'بدون ضامن'],
    }),
    rule({ id: 'PAUSED', name: 'تسهیلات قدیمی', priceAmount: '1000', priceCurrency: 'IRT', available: false }),
  ];
  const run = (body: string, allowedIds: string[] = ['F']) =>
    checkContentQuality({
      title: '',
      body,
      hashtags: [],
      cta: '',
      platform: 'INSTAGRAM',
      format: 'POST',
      offerings,
      focus: { offeringId: 'F', allowedIds },
    }).issues.filter((i) => i.code === 'OFFERING_CROSSED');

  it("warns when another offering's price is stated in a sentence that names it", () => {
    const issues = run('تسهیلات مسکن را با ۵۰ میلیون تومان بگیرید.');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warn',
      params: { focus: 'تسهیلات تجهیزات', other: 'تسهیلات مسکن', what: 'price' },
    });
  });

  it("warns when another offering's own feature is claimed for it", () => {
    const issues = run('تسهیلات مسکن بدون ضامن است.');
    expect(issues[0]?.params.what).toBe('feature');
  });

  it('is quiet about a plain mention, the focused offering itself and its own price', () => {
    expect(run('اگر خانه می‌خواهید به تسهیلات مسکن هم نگاه کنید.')).toEqual([]);
    expect(run('تسهیلات تجهیزات با ۱۰ میلیون تومان و اقساط ۱۲ ماهه.')).toEqual([]);
  });

  it('lets an allowed offering (a complement, a variant, its line) be mentioned freely', () => {
    expect(run('تسهیلات مسکن را با ۵۰ میلیون تومان بگیرید.', ['F', 'O'])).toEqual([]);
  });

  it('ignores offerings that cannot be sold, and does nothing without a focus', () => {
    expect(run('تسهیلات قدیمی با ۱۰۰۰ تومان.')).toEqual([]);
    const without = checkContentQuality({
      title: '',
      body: 'تسهیلات مسکن را با ۵۰ میلیون تومان بگیرید.',
      hashtags: [],
      cta: '',
      platform: 'INSTAGRAM',
      format: 'POST',
      offerings,
    });
    expect(without.issues.some((i) => i.code === 'OFFERING_CROSSED')).toBe(false);
  });

  it('does nothing when the focused offering is not among the usable ones', () => {
    const issues = checkContentQuality({
      title: '',
      body: 'تسهیلات مسکن را با ۵۰ میلیون تومان بگیرید.',
      hashtags: [],
      cta: '',
      platform: 'INSTAGRAM',
      format: 'POST',
      offerings: offerings.filter((o) => o.id !== 'F'),
      focus: { offeringId: 'F', allowedIds: ['F'] },
    }).issues;
    expect(issues.some((i) => i.code === 'OFFERING_CROSSED')).toBe(false);
  });
});
