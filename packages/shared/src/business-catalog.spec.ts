import { describe, expect, it } from 'vitest';
import {
  CreateBusinessOfferingSchema,
  formatOfferingPrice,
  hasValidPrice,
  isOfferingAvailable,
  offeringQualityRule,
  resolveOfferingProposals,
  UpdateBusinessOfferingSchema,
  type OfferingCore,
  type OfferingsExtract,
} from './business-catalog';
import { checkContentQuality, comparePrice, extractPrices } from './quality';

const offering = (over: Partial<OfferingCore> = {}): OfferingCore => ({
  name: 'اشتراک طلایی',
  aliases: [],
  kind: 'PLAN',
  status: 'ACTIVE',
  push: 2,
  summary: '',
  features: [],
  priceAmount: '199000',
  priceCurrency: 'IRT',
  priceFrom: false,
  priceUnit: 'ماهانه',
  priceValidUntil: null,
  availableFrom: null,
  availableUntil: null,
  ...over,
});

const NOW = new Date('2026-10-22T10:00:00Z');

describe('extractPrices', () => {
  it('reads an amount next to a currency, with scale words, digits and separators in any script', () => {
    expect(extractPrices('فقط ۱۹۹ هزار تومان')).toEqual([{ value: 199000, currency: 'IRT' }]);
    expect(extractPrices('۱٬۹۹۰٬۰۰۰ ریال')).toEqual([{ value: 1990000, currency: 'IRR' }]);
    expect(extractPrices('199,000 تومانی')).toEqual([{ value: 199000, currency: 'IRT' }]);
    expect(extractPrices('2.5 میلیون تومان')).toEqual([{ value: 2500000, currency: 'IRT' }]);
    expect(extractPrices('only $20 or 15 euros')).toEqual([
      { value: 15, currency: 'EUR' },
      { value: 20, currency: 'USD' },
    ]);
  });

  it('does not take a number without a currency for a price', () => {
    expect(extractPrices('۳ ماه ضمانت و ۲۴ ساعته پشتیبانی')).toEqual([]);
    expect(extractPrices('سفارش تا ۲۰ آبان')).toEqual([]);
  });
});

describe('comparePrice', () => {
  const offer = { amount: 199000, currency: 'IRT' };
  it('matches the same amount, and toman against rial through ×10', () => {
    expect(comparePrice(offer, { value: 199000, currency: 'IRT' })).toBe('match');
    expect(comparePrice(offer, { value: 1990000, currency: 'IRR' })).toBe('match');
    expect(comparePrice({ amount: 1990000, currency: 'IRR' }, { value: 199000, currency: 'IRT' })).toBe(
      'match',
    );
    expect(comparePrice(offer, { value: 299000, currency: 'IRT' })).toBe('mismatch');
  });
  it('does not compare different currencies, and accepts more for a "from" price', () => {
    expect(comparePrice(offer, { value: 20, currency: 'USD' })).toBe('incomparable');
    expect(comparePrice({ ...offer, from: true }, { value: 250000, currency: 'IRT' })).toBe('match');
    expect(comparePrice({ ...offer, from: true }, { value: 150000, currency: 'IRT' })).toBe('mismatch');
  });
});

describe('checkContentQuality with offerings', () => {
  const run = (body: string, o: OfferingCore = offering(), now = NOW) =>
    checkContentQuality({
      title: '',
      body,
      hashtags: [],
      cta: '',
      platform: 'INSTAGRAM',
      format: 'POST',
      offerings: [offeringQualityRule(o, now)],
      now,
    }).issues.filter((i) => i.code.startsWith('OFFERING') || i.code === 'FACT_EXPIRED');

  it('accepts the registered price however it is written', () => {
    expect(run('اشتراک طلایی فقط ۱۹۹ هزار تومان.')).toEqual([]);
    expect(run('اشتراک طلایی: ۱٬۹۹۰٬۰۰۰ ریال')).toEqual([]);
    expect(run('اشتراک طلایی ماهانه ۱۹۹,۰۰۰ تومان است')).toEqual([]);
  });

  it('flags another price for the offering', () => {
    const issues = run('اشتراک طلایی فقط ۲۹۹ هزار تومان.');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'OFFERING_PRICE_MISMATCH',
      severity: 'warn',
      params: { name: 'اشتراک طلایی', expected: '199000 IRT' },
    });
  });

  it('ignores numbers that are not prices and sentences about something else', () => {
    expect(run('اشتراک طلایی سه ماه ضمانت دارد و ۲۴ ساعته پشتیبانی می‌شود.')).toEqual([]);
    expect(run('اشتراک نقره‌ای ۹۹ هزار تومان است.')).toEqual([]);
  });

  it('knows the aliases of an offering', () => {
    const o = offering({ aliases: ['Gold plan'] });
    expect(run('Gold plan is 299 هزار تومان today', o)).toHaveLength(1);
  });

  it('names an offering that is not for sale', () => {
    const issues = run('اشتراک طلایی را همین امروز بخرید!', offering({ status: 'PAUSED' }));
    expect(issues.map((i) => i.code)).toEqual(['OFFERING_UNAVAILABLE']);
    expect(run('اشتراک طلایی را بخرید', offering({ status: 'SEASONAL', availableUntil: '2026-09-30' }))).toHaveLength(1);
    expect(run('اشتراک طلایی را بخرید', offering({ status: 'SEASONAL', availableUntil: '2026-12-30' }))).toEqual([]);
  });

  it('reports a price whose validity ran out as expired, not as a mismatch', () => {
    const issues = run('اشتراک طلایی ۱۹۹ هزار تومان', offering({ priceValidUntil: '2026-10-01' }));
    expect(issues.map((i) => i.code)).toEqual(['FACT_EXPIRED']);
    expect(issues[0]!.params).toMatchObject({ label: 'اشتراک طلایی', validUntil: '2026-10-01' });
  });

  it('says nothing about an offering without a price when only its name is used', () => {
    expect(run('اشتراک طلایی را امتحان کنید', offering({ priceAmount: null, priceCurrency: null }))).toEqual([]);
  });
});

describe('offering rules', () => {
  it('formats the price with grouping, "from" and the unit', () => {
    expect(formatOfferingPrice(offering())).toBe('199,000 تومان / ماهانه');
    expect(formatOfferingPrice(offering({ priceFrom: true, priceUnit: '' }))).toBe('from 199,000 تومان');
    expect(formatOfferingPrice(offering({ priceAmount: '12.5', priceCurrency: 'USD', priceUnit: '' }))).toBe(
      '12.5 USD',
    );
    expect(formatOfferingPrice(offering({ priceAmount: null }))).toBe('');
  });

  it('accepts a decimal object from the database driver', () => {
    const decimal = { toString: () => '199000' };
    expect(formatOfferingPrice(offering({ priceAmount: decimal }))).toBe('199,000 تومان / ماهانه');
    expect(offeringQualityRule(offering({ priceAmount: decimal })).priceAmount).toBe('199000');
  });

  it('has a valid price only with an amount, a currency and a date that has not passed', () => {
    expect(hasValidPrice(offering(), NOW)).toBe(true);
    expect(hasValidPrice(offering({ priceCurrency: null }), NOW)).toBe(false);
    expect(hasValidPrice(offering({ priceValidUntil: '2026-10-21' }), NOW)).toBe(false);
    expect(hasValidPrice(offering({ priceValidUntil: '2026-10-22' }), NOW)).toBe(true);
  });

  it('sells a seasonal offering without dates, and stops paused or discontinued ones', () => {
    expect(isOfferingAvailable(offering({ status: 'SEASONAL' }), NOW)).toBe(true);
    expect(isOfferingAvailable(offering({ status: 'PAUSED' }), NOW)).toBe(false);
    expect(isOfferingAvailable(offering({ status: 'DISCONTINUED' }), NOW)).toBe(false);
    expect(isOfferingAvailable(offering({ availableFrom: '2026-11-01' }), NOW)).toBe(false);
  });
});

describe('CreateBusinessOfferingSchema', () => {
  it('reads a price typed in Persian digits and keeps a canonical decimal', () => {
    const r = CreateBusinessOfferingSchema.parse({
      name: ' اشتراک ',
      priceAmount: '۱۹۹٬۰۰۰',
      priceCurrency: 'IRT',
    });
    expect(r).toMatchObject({ name: 'اشتراک', priceAmount: '199000', priceCurrency: 'IRT', push: 1 });
  });

  it('needs a currency with a price and a price with a currency', () => {
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x', priceAmount: '100' }).success).toBe(false);
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x', priceCurrency: 'IRT' }).success).toBe(false);
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x' }).success).toBe(true);
  });

  it('refuses a bad price, a season that ends before it starts and too many aliases', () => {
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x', priceAmount: 'abc', priceCurrency: 'IRT' }).success).toBe(false);
    expect(
      CreateBusinessOfferingSchema.safeParse({ name: 'x', availableFrom: '2026-12-01', availableUntil: '2026-11-01' }).success,
    ).toBe(false);
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x', aliases: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).success).toBe(false);
  });

  it('an update changes only what it names', () => {
    expect(UpdateBusinessOfferingSchema.parse({ push: 3 })).toEqual({ push: 3 });
  });
});

describe('resolveOfferingProposals', () => {
  const SOURCE = 'اشتراک طلایی ماهانه ۱۹۹ هزار تومان است و شامل پشتیبانی می‌شود. مشاوره رایگان هم داریم.';
  const proposal = (over: Partial<OfferingsExtract['offerings'][number]> = {}) => ({
    name: 'اشتراک طلایی',
    aliases: [],
    kind: 'PLAN' as const,
    summary: '',
    features: [],
    priceAmount: '199000',
    priceCurrency: 'IRT' as const,
    priceFrom: false,
    priceUnit: 'ماهانه',
    evidence: 'اشتراک طلایی ماهانه ۱۹۹ هزار تومان',
    ...over,
  });
  const run = (proposals: OfferingsExtract['offerings'], existing: string[] = [], room = 10) =>
    resolveOfferingProposals({ proposals, sources: [SOURCE], existing, room });

  it('keeps a row whose quote and price are in the source', () => {
    const r = run([proposal()]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'اشتراک طلایی', priceAmount: '199000', priceCurrency: 'IRT' });
    expect(r.dropped).toEqual([]);
  });

  it('drops a row whose quote is not in any source, or whose name the sources never use', () => {
    expect(run([proposal({ evidence: 'این جمله هیچ‌جا نیست' })]).dropped[0]?.reason).toBe('NO_EVIDENCE');
    expect(run([proposal({ evidence: '' })]).dropped[0]?.reason).toBe('NO_EVIDENCE');
    expect(
      run([proposal({ name: 'بستهٔ پلاتینیوم', evidence: 'شامل پشتیبانی می‌شود' })]).dropped[0]?.reason,
    ).toBe('NAME_NOT_IN_SOURCES');
  });

  it('keeps the row but not a price the quote does not state', () => {
    const wrong = run([proposal({ priceAmount: '299000' })]);
    expect(wrong.rows[0]?.priceAmount).toBeNull();
    expect(wrong.rows[0]?.priceUnit).toBe('');
    expect(wrong.priceDropped).toEqual(['اشتراک طلایی']);
    const noCurrency = run([proposal({ priceCurrency: 'NONE' })]);
    expect(noCurrency.rows[0]?.priceAmount).toBeNull();
  });

  it('accepts the price stated in rial for a toman row', () => {
    const r = resolveOfferingProposals({
      proposals: [proposal({ evidence: 'اشتراک طلایی ۱٬۹۹۰٬۰۰۰ ریال' })],
      sources: ['اشتراک طلایی ۱٬۹۹۰٬۰۰۰ ریال در ماه'],
      existing: [],
      room: 5,
    });
    expect(r.rows[0]?.priceAmount).toBe('199000');
  });

  it('drops repeats and names already in the catalog, and stops at the room left', () => {
    expect(run([proposal(), proposal()]).dropped.map((d) => d.reason)).toEqual(['DUPLICATE']);
    expect(run([proposal()], ['اشتراک طلایی']).dropped[0]?.reason).toBe('DUPLICATE');
    expect(run([proposal()], ['اشتراک  طلايي']).dropped[0]?.reason).toBe('DUPLICATE');
    const two = run(
      [proposal(), proposal({ name: 'مشاوره', evidence: 'مشاوره رایگان هم داریم', priceAmount: '', priceCurrency: 'NONE' })],
      [],
      1,
    );
    expect(two.rows).toHaveLength(1);
    expect(two.dropped[0]?.reason).toBe('LIMIT');
  });
});
