import { describe, expect, it } from 'vitest';
import {
  MIN_LABELED_FOR_SHARE,
  SavePillarsSchema,
  buildCoverage,
  type ContentPillar,
  type CoverageItem,
} from './coverage';

const now = new Date('2026-10-14T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const pillars: ContentPillar[] = [
  { id: 'edu', name: 'آموزش', targetShare: 50, order: 0 },
  { id: 'sale', name: 'فروش', targetShare: 30, order: 1 },
  { id: 'story', name: 'داستان برند', targetShare: null, order: 2 },
];

const item = (
  pillarId: string | null,
  daysBack: number,
  platform: CoverageItem['platform'] = 'INSTAGRAM',
): CoverageItem => ({ pillarId, platform, at: daysAgo(daysBack) });

const opts = { days: 90, by: 'platform' as const, staleDays: 30, now };
const row = (r: ReturnType<typeof buildCoverage>, id: string | null) =>
  r.rows.find((x) => x.pillarId === id)!;

describe('buildCoverage', () => {
  it('with no content it is an empty map, not an error, and every pillar is stale', () => {
    const r = buildCoverage(pillars, [], opts);
    expect(r.total).toBe(0);
    expect(r.enoughLabeled).toBe(false);
    expect(r.rows.map((x) => x.pillarId)).toEqual(['edu', 'sale', 'story', null]);
    expect(r.rows.slice(0, 3).every((x) => x.stale && x.daysSince === null && x.total === 0)).toBe(
      true,
    );
    expect(row(r, null).stale).toBe(false);
  });

  it('counts per platform and keeps unlabeled content in its own row', () => {
    const r = buildCoverage(
      pillars,
      [item('edu', 3), item('edu', 5, 'X'), item('sale', 9), item(null, 2), item('gone', 1)],
      opts,
    );
    const col = (p: string) => r.columns.indexOf(p);
    expect(row(r, 'edu').counts[col('INSTAGRAM')]).toBe(1);
    expect(row(r, 'edu').counts[col('X')]).toBe(1);
    // a deleted pillar's content is unlabeled, not lost
    expect(row(r, null).total).toBe(2);
    expect(r.total).toBe(5);
    expect(r.labeled).toBe(3);
  });

  it('counts per 30-day period, newest first, and leaves out what is older than the window', () => {
    const r = buildCoverage(
      pillars,
      [item('edu', 1), item('edu', 29), item('edu', 31), item('edu', 70), item('edu', 100)],
      { ...opts, by: 'period' },
    );
    expect(r.columns).toEqual(['P0', 'P1', 'P2']);
    expect(row(r, 'edu').counts).toEqual([2, 1, 1]);
    expect(row(r, 'edu').total).toBe(4);
  });

  it('flags a pillar with nothing in staleDays, using content older than the window too', () => {
    const r = buildCoverage(pillars, [item('edu', 3), item('sale', 45), item('story', 200)], {
      ...opts,
      days: 30,
      staleDays: 30,
    });
    expect(row(r, 'edu').stale).toBe(false);
    expect(row(r, 'sale').stale).toBe(true);
    expect(row(r, 'sale').daysSince).toBe(45);
    // older than the window: not counted, but it is when it was last covered
    expect(row(r, 'story').total).toBe(0);
    expect(row(r, 'story').daysSince).toBe(200);
  });

  it('compares shares with targets only with enough labeled content', () => {
    const few = buildCoverage(pillars, [item('edu', 1), item('sale', 2)], opts);
    expect(few.enoughLabeled).toBe(false);
    expect(row(few, 'edu').share).toBeNull();
    expect(row(few, 'edu').gap).toBeNull();

    const items = [
      ...Array.from({ length: 2 }, () => item('edu', 3)),
      ...Array.from({ length: 3 }, () => item('sale', 4)),
      item(null, 1),
    ];
    expect(items.filter((i) => i.pillarId).length).toBeGreaterThanOrEqual(MIN_LABELED_FOR_SHARE);
    const r = buildCoverage(pillars, items, opts);
    expect(row(r, 'edu').share).toBe(40);
    expect(row(r, 'edu').gap).toBe(10); // wants 50, has 40
    expect(row(r, 'sale').share).toBe(60);
    expect(row(r, 'sale').gap).toBe(-30);
    expect(row(r, 'story').gap).toBeNull(); // no target
    expect(row(r, null).share).toBeNull();
  });

  it('is deterministic and ignores content dated in the future', () => {
    const items = [item('edu', 3), item('edu', -2)];
    const a = buildCoverage(pillars, items, opts);
    expect(buildCoverage(pillars, items, opts)).toEqual(a);
    expect(row(a, 'edu').total).toBe(1);
  });
});

describe('SavePillarsSchema', () => {
  it('accepts a list, defaults the target and keeps ids', () => {
    const r = SavePillarsSchema.parse({ pillars: [{ id: 'p1', name: ' آموزش ' }] });
    expect(r.pillars[0]).toEqual({ id: 'p1', name: 'آموزش', targetShare: null });
  });

  it('refuses a duplicate name (also with Arabic letters), too many pillars and targets over 100', () => {
    expect(
      SavePillarsSchema.safeParse({ pillars: [{ name: 'کتاب' }, { name: 'كتاب' }] }).success,
    ).toBe(false);
    expect(
      SavePillarsSchema.safeParse({
        pillars: Array.from({ length: 13 }, (_, i) => ({ name: `p${i}` })),
      }).success,
    ).toBe(false);
    expect(
      SavePillarsSchema.safeParse({
        pillars: [
          { name: 'a', targetShare: 60 },
          { name: 'b', targetShare: 50 },
        ],
      }).success,
    ).toBe(false);
  });
});
