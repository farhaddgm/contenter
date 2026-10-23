import { describe, expect, it } from 'vitest';
import { COMPARE_METRICS, compareBrands, metricValue } from './brand-compare';
import type { InstagramStats } from './social';

const stats = (over: Partial<InstagramStats> = {}): InstagramStats => ({
  postsAnalyzed: 20,
  firstPostAt: null,
  lastPostAt: null,
  postsPerWeek: 3,
  formatMix: {},
  avgCaptionChars: 200,
  emptyCaptions: 0,
  avgEmojisPerPost: 2,
  avgHashtagsPerPost: 4,
  topHashtags: [{ tag: '#قهوه', count: 9 }, { tag: '#Cafe', count: 5 }],
  topMentions: [],
  scriptShare: { persian: 0.8, latin: 0.2 },
  ctaShare: 0.3,
  questionShare: 0.1,
  engagement: { postsWithCounts: 20, avgLikes: 50, avgComments: 5, ratePct: 2 },
  topPosts: [],
  ...over,
});

const row = (r: ReturnType<typeof compareBrands>, metric: (typeof COMPARE_METRICS)[number]) =>
  r.rows.find((x) => x.metric === metric)!;

describe('compareBrands', () => {
  it('lists every metric with the brand value, each competitor value and their range', () => {
    const out = compareBrands({
      brand: stats(),
      competitors: [
        { id: 'a', name: 'الف', stats: stats({ postsPerWeek: 7 }) },
        { id: 'b', name: 'ب', stats: stats({ postsPerWeek: 1 }) },
      ],
    });
    expect(out.rows.map((r) => r.metric)).toEqual([...COMPARE_METRICS]);
    expect(row(out, 'postsPerWeek')).toMatchObject({ brand: 3, min: 1, max: 7 });
    expect(row(out, 'postsPerWeek').values).toEqual([
      { id: 'a', value: 7 },
      { id: 'b', value: 1 },
    ]);
    expect(row(out, 'persianShare').brand).toBe(0.8);
  });

  it('says "not enough data" under 6 posts instead of showing numbers', () => {
    const out = compareBrands({
      brand: stats({ postsAnalyzed: 4 }),
      competitors: [
        { id: 'a', name: 'الف', stats: stats({ postsAnalyzed: 5 }) },
        { id: 'b', name: 'ب', stats: null },
        { id: 'c', name: 'ج', stats: stats() },
      ],
    });
    expect(out.brand).toEqual({ state: 'TOO_FEW', posts: 4 });
    expect(out.competitors.map((c) => c.state)).toEqual(['TOO_FEW', 'NONE', 'OK']);
    expect(row(out, 'avgCaptionChars').brand).toBeNull();
    expect(row(out, 'avgCaptionChars').values.map((v) => v.value)).toEqual([null, null, 200]);
  });

  it('shows the engagement rate only when both sides have a follower-based rate', () => {
    const noFollowers = stats({ engagement: { postsWithCounts: 20, avgLikes: 1, avgComments: 1, ratePct: null } });
    const both = compareBrands({ brand: stats(), competitors: [{ id: 'a', name: 'الف', stats: stats({ engagement: { ...stats().engagement!, ratePct: 5 } }) }] });
    expect(row(both, 'engagementRatePct')).toMatchObject({ brand: 2, min: 5, max: 5, followerDependent: true });
    const brandWithout = compareBrands({ brand: noFollowers, competitors: [{ id: 'a', name: 'الف', stats: stats() }] });
    expect(row(brandWithout, 'engagementRatePct').values[0]!.value).toBeNull();
    const theirsWithout = compareBrands({ brand: stats(), competitors: [{ id: 'a', name: 'الف', stats: noFollowers }] });
    expect(row(theirsWithout, 'engagementRatePct').min).toBeNull();
  });

  it('finds shared hashtags (folded) and those only the competitors use', () => {
    const out = compareBrands({
      brand: stats({ topHashtags: [{ tag: '#قهوه', count: 5 }, { tag: '#Cafe', count: 3 }] }),
      competitors: [
        { id: 'a', name: 'الف', stats: stats({ topHashtags: [{ tag: '#cafe', count: 9 }, { tag: '#تخفیف', count: 8 }] }) },
        { id: 'b', name: 'ب', stats: stats({ topHashtags: [{ tag: '#تخفیف', count: 4 }] }) },
      ],
    });
    expect(out.hashtags.shared).toEqual(['cafe']);
    expect(out.hashtags.onlyTheirs).toEqual([{ tag: '#تخفیف', from: ['الف', 'ب'] }]);
    // shared 1 of 3 distinct tags (قهوه, cafe, تخفیف)
    expect(out.hashtags.overlap).toBeCloseTo(1 / 3);
  });

  it('has no overlap figure without a usable brand or competitor', () => {
    expect(compareBrands({ brand: null, competitors: [{ id: 'a', name: 'الف', stats: stats() }] }).hashtags.overlap).toBeNull();
    expect(compareBrands({ brand: stats(), competitors: [] }).hashtags.overlap).toBeNull();
  });

  it('reads each metric from the statistics', () => {
    expect(metricValue(stats({ postsPerWeek: null }), 'postsPerWeek')).toBeNull();
    expect(metricValue(stats(), 'questionShare')).toBe(0.1);
  });
});
