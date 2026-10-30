import { describe, expect, it } from 'vitest';
import {
  buildProfileQuestions,
  checkContentQuality,
  isAlternativeStale,
  offeringQualityRule,
  parseAlternatives,
  staleAlternatives,
  type OfferingCore,
} from '@contenter/shared';
import { formatBusinessCatalog, type OfferingForPrompt } from '../ai/context';

const NOW = new Date('2026-10-30T00:00:00Z');

const offering = (over: Partial<OfferingForPrompt> = {}): OfferingForPrompt => ({
  id: 'a',
  name: 'اشتراک طلایی',
  aliases: [],
  kind: 'PLAN',
  status: 'ACTIVE',
  push: 2,
  summary: '',
  features: [],
  priceAmount: null,
  priceCurrency: null,
  priceFrom: false,
  priceUnit: '',
  priceValidUntil: null,
  availableFrom: null,
  availableUntil: null,
  ...over,
});

describe('alternatives and "not for" (docs/74)', () => {
  const alt = [
    { name: 'دیجی‌کالا', kind: 'COMPETITOR', ourEdge: 'پشتیبانی فارسی', theirEdge: 'ارسال سریع‌تر', checkedOn: '2026-10-01' },
    { name: 'خودت بساز', kind: 'DIY', ourEdge: 'صرفه‌جویی در زمان', theirEdge: '', checkedOn: '' },
  ];

  it('keeps the catalog byte-for-byte without alternatives or "not for"', () => {
    const plain = formatBusinessCatalog([offering()], NOW);
    expect(formatBusinessCatalog([offering({ alternatives: [], notFor: [] })], NOW)).toBe(plain);
    expect(plain).not.toContain('Versus');
    expect(plain).not.toContain('Not for');
  });

  it('prints both sides of each alternative and the "not for" line, with the instruction', () => {
    const out = formatBusinessCatalog([offering({ alternatives: alt, notFor: ['کسی که باغ ندارد'] })], NOW);
    expect(out).toContain('Versus alternatives');
    expect(out).toContain('- دیجی‌کالا [competitor]\n      we are better: پشتیبانی فارسی\n      it is better: ارسال سریع‌تر');
    expect(out).toContain('Not for: کسی که باغ ندارد');
    expect(out).toMatch(/shape the angle only/);
  });

  it('flags a rival never checked or checked long ago as unchecked, but not DIY', () => {
    const old = [{ ...alt[0]!, checkedOn: '2026-01-01' }, alt[1]!, { ...alt[0]!, name: 'بی‌تاریخ', checkedOn: '' }];
    const out = formatBusinessCatalog([offering({ alternatives: old })], NOW);
    expect(out).toContain('دیجی‌کالا [competitor] (unchecked or old');
    expect(out).toContain('بی‌تاریخ [competitor] (unchecked or old');
    expect(out).not.toContain('خودت بساز [do it yourself] (unchecked');
    expect(staleAlternatives(parseAlternatives(old), NOW)).toBe(2);
    expect(isAlternativeStale({ kind: 'COMPETITOR', checkedOn: '2026-10-01' }, NOW)).toBe(false);
  });

  it('drops malformed JSON instead of failing', () => {
    expect(parseAlternatives('nope')).toEqual([]);
    expect(parseAlternatives([{ name: '' }])).toEqual([]);
  });

  it('warns (only) when a text about the offering names a competitor, not a DIY alternative', () => {
    const core: OfferingCore = offering({ alternatives: alt });
    const run = (body: string) =>
      checkContentQuality({
        title: '',
        body,
        hashtags: [],
        cta: '',
        platform: 'INSTAGRAM',
        format: 'POST',
        offerings: [offeringQualityRule(core, NOW)],
        now: NOW,
      }).issues.filter((i) => i.code === 'ALTERNATIVE_NAMED');
    const hits = run('اشتراک طلایی از دیجی‌کالا بهتر است.');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: 'warn', params: { rival: 'دیجی‌کالا' } });
    expect(run('اشتراک طلایی؛ به‌جای خودت بساز.')).toHaveLength(0);
    // a text that does not talk about the offering is left alone
    expect(run('امروز از دیجی‌کالا خرید کردم.')).toHaveLength(0);
  });

  it('asks about priority offerings with no alternative and about stale rivals, only when counted', () => {
    const base = {
      sections: [],
      skipped: [],
      counts: { facts: 1, competitors: 1, offerings: 2, offeringsWithoutClaims: 0, unprovenClaims: 0 },
    };
    const codes = (extra: object) =>
      buildProfileQuestions({ ...base, counts: { ...base.counts, ...extra } }).questions.map((q) => q.code);
    expect(codes({})).not.toContain('OFFERINGS_NO_ALTERNATIVES');
    expect(codes({ offeringsWithoutAlternatives: 2, staleAlternatives: 1 })).toEqual(
      expect.arrayContaining(['OFFERINGS_NO_ALTERNATIVES', 'ALTERNATIVES_STALE']),
    );
  });
});
