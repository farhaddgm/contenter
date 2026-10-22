import { describe, expect, it } from 'vitest';
import { findStale, type StaleCandidate } from './stale';

const cand = (over: Partial<StaleCandidate>): StaleCandidate => ({
  id: 'c1',
  title: 'پست قیمت',
  status: 'APPROVED',
  platform: 'INSTAGRAM',
  format: 'POST',
  publishedAt: null,
  scheduledAt: null,
  topic: { id: 't1', title: 'پروژه' },
  versionTitle: 'قیمت جدید',
  body: 'قیمت اشتراک ماهانه ۵۰۰ هزار تومان است.',
  hashtags: [],
  cta: '',
  ...over,
});

const facts = [{ label: 'قیمت اشتراک ماهانه', value: '۶۰۰ هزار تومان' }];

describe('findStale', () => {
  it('finds a content that quotes an old number', () => {
    const out = findStale([cand({})], facts);
    expect(out).toHaveLength(1);
    expect(out[0]!.issues[0]!.code).toBe('FACT_NUMBER_MISMATCH');
  });

  it('finds a content that still carries an expired fact', () => {
    const out = findStale(
      [cand({ body: 'قیمت اشتراک ماهانه ۶۰۰ هزار تومان است.' })],
      [{ ...facts[0]!, validUntil: '2026-01-01' }],
      new Date('2026-06-01'),
    );
    expect(out[0]!.issues.map((i) => i.code)).toContain('FACT_EXPIRED');
  });

  it('leaves a matching content alone and ignores other quality notes', () => {
    expect(findStale([cand({ body: 'قیمت اشتراک ماهانه ۶۰۰ هزار تومان است.' })], facts)).toEqual(
      [],
    );
    expect(findStale([cand({ body: 'متن  با فاصلهٔ  دوتایی ،' })], facts)).toEqual([]);
  });

  it('does nothing without facts and lists the published ones first', () => {
    expect(findStale([cand({})], [])).toEqual([]);
    const out = findStale(
      [
        cand({ id: 'a' }),
        cand({ id: 'b', publishedAt: '2026-05-01T00:00:00Z', status: 'APPROVED' }),
      ],
      facts,
    );
    expect(out.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('finds content that quotes an old catalog price, with no key facts at all', () => {
    const offerings = [
      { name: 'اشتراک ماهانه', priceAmount: '600000', priceCurrency: 'IRT', available: true },
    ];
    const out = findStale([cand({})], [], new Date('2026-06-01'), offerings);
    expect(out).toHaveLength(1);
    expect(out[0]!.issues.map((i) => i.code)).toEqual(['OFFERING_PRICE_MISMATCH']);
    // the current price is fine, and an unavailable offering is not "stale" by itself
    expect(
      findStale([cand({ body: 'اشتراک ماهانه ۶۰۰ هزار تومان است.' })], [], new Date('2026-06-01'), offerings),
    ).toEqual([]);
    expect(
      findStale([cand({ body: 'اشتراک ماهانه را امتحان کنید.' })], [], new Date('2026-06-01'), [
        { ...offerings[0]!, available: false },
      ]),
    ).toEqual([]);
  });
});
