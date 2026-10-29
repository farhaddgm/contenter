import { describe, expect, it } from 'vitest';
import type { OfferingCore } from './business-catalog';
import { buildOfferingCoverage, type CoverageContent } from './offering-coverage';

const NOW = new Date('2026-10-29T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const offering = (id: string, over: Partial<OfferingCore> = {}): OfferingCore & { id: string } => ({
  id,
  name: `محصول ${id}`,
  aliases: [],
  kind: 'SERVICE',
  status: 'ACTIVE',
  push: 1,
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

const content = (offeringId: string | null, segmentId: string | null, days: number): CoverageContent => ({
  offeringId,
  segmentId,
  at: ago(days),
});

const segments = [
  { id: 's1', name: 'کارمند', kind: 'PERSONA' },
  { id: 's2', name: 'کسب‌وکار کوچک', kind: 'MARKET' },
];

describe('buildOfferingCoverage', () => {
  const offerings = [
    offering('L', { name: 'خط' }),
    offering('V1', { parentId: 'L', name: 'گونه ۱' }),
    offering('V2', { parentId: 'L', name: 'گونه ۲' }),
    offering('X', { name: 'مستقل' }),
  ];

  it('counts the three windows, nested, for the offering itself and with its variants', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links: [],
      contents: [content('V1', null, 5), content('V1', null, 45), content('V1', null, 80), content('L', null, 20)],
      now: NOW,
    });
    const row = (id: string) => report.rows.find((r) => r.offeringId === id)!;
    expect(row('V1').own).toEqual({ 30: 1, 60: 2, 90: 3 });
    expect(row('L').own).toEqual({ 30: 1, 60: 1, 90: 1 });
    expect(row('L').subtree).toEqual({ 30: 2, 60: 3, 90: 4 });
    expect(row('X').subtree).toEqual({ 30: 0, 60: 0, 90: 0 });
    expect(report.total).toBe(4);
  });

  it('lists variants right under their line with their depth', () => {
    const report = buildOfferingCoverage({ offerings, segments, links: [], contents: [], now: NOW });
    expect(report.rows.map((r) => `${r.depth}:${r.offeringId}`)).toEqual(['0:L', '1:V1', '1:V2', '0:X']);
    expect(report.rows[1]!.parentId).toBe('L');
  });

  it('flags a promotable offering with nothing for staleDays, and a line is covered by its variants', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links: [],
      contents: [content('V1', null, 3), content('X', null, 40)],
      staleDays: 30,
      now: NOW,
    });
    const stale = report.rows.filter((r) => r.stale).map((r) => r.offeringId);
    expect(stale).toEqual(['V2', 'X']);
    expect(report.rows.find((r) => r.offeringId === 'L')!.daysSince).toBe(3);
    expect(report.rows.find((r) => r.offeringId === 'X')!.daysSince).toBe(40);
  });

  it('never calls an offering uncovered when it cannot be sold or is not to be pushed', () => {
    const report = buildOfferingCoverage({
      offerings: [offering('P', { status: 'PAUSED' }), offering('Q', { push: 0 }), offering('R', { stock: 'OUT' })],
      segments,
      links: [],
      contents: [],
      now: NOW,
    });
    expect(report.rows.every((r) => !r.promotable && !r.stale)).toBe(true);
  });

  it('ignores contents older than 90 days, and counts a future date as today', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links: [],
      contents: [content('X', null, 120), { offeringId: 'X', segmentId: null, at: ago(-5) }],
      now: NOW,
    });
    expect(report.rows.find((r) => r.offeringId === 'X')!.own).toEqual({ 30: 1, 60: 1, 90: 1 });
    expect(report.total).toBe(1);
  });

  it('keeps contents without an offering, or with an unknown one, on their own line', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links: [],
      contents: [content(null, null, 2), content('gone', null, 50)],
      now: NOW,
    });
    expect(report.withoutOffering).toEqual({ 30: 1, 60: 2, 90: 2 });
    expect(report.rows.every((r) => r.own[90] === 0)).toBe(true);
  });

  it('counts contents with an offering but no audience', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links: [],
      contents: [content('X', null, 2), content('X', 'unknown', 3), content('X', 's1', 4)],
      now: NOW,
    });
    expect(report.withoutAudience).toBe(2);
  });
});

describe('the offering × audience matrix', () => {
  const offerings = [offering('A'), offering('B'), offering('C', { status: 'PAUSED' })];
  const links = [
    { offeringId: 'A', segmentId: 's1', fit: 2 },
    { offeringId: 'A', segmentId: 's2', fit: 1 },
    { offeringId: 'C', segmentId: 's1', fit: 2 },
    { offeringId: 'gone', segmentId: 's1', fit: 2 },
  ];

  it('has a cell for every linked pair, with its count, and marks a linked pair with no content as a gap', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links,
      contents: [content('A', 's1', 10), content('A', 's1', 70)],
      now: NOW,
    });
    const cell = (o: string, s: string) => report.cells.find((c) => c.offeringId === o && c.segmentId === s)!;
    expect(cell('A', 's1')).toMatchObject({ linked: true, fit: 2, count: 2, gap: false });
    expect(cell('A', 's1').lastAt).toBe(ago(10));
    expect(cell('A', 's2')).toMatchObject({ linked: true, fit: 1, count: 0, gap: true, lastAt: null });
    // an offering that cannot be sold is not an opportunity
    expect(cell('C', 's1')).toMatchObject({ linked: true, count: 0, gap: false });
    // a link to an offering that no longer exists is dropped
    expect(report.cells.some((c) => c.offeringId === 'gone')).toBe(false);
  });

  it('shows content for a pair the admin did not link, without calling it a gap', () => {
    const report = buildOfferingCoverage({
      offerings,
      segments,
      links: [],
      contents: [content('B', 's2', 1)],
      now: NOW,
    });
    expect(report.cells).toEqual([
      expect.objectContaining({ offeringId: 'B', segmentId: 's2', linked: false, fit: 0, count: 1, gap: false }),
    ]);
  });

  it('is deterministic: cells are ordered by offering, then audience', () => {
    const report = buildOfferingCoverage({ offerings, segments, links: [...links].reverse(), contents: [], now: NOW });
    const keys = report.cells.map((c) => `${c.offeringId}:${c.segmentId}`);
    expect(keys).toEqual([...keys].sort());
  });
});
