import { describe, expect, it } from 'vitest';
import { GoldenSettingsSchema, pickGoldenExamples, type GoldenCandidate } from './golden';

const c = (
  id: string,
  platform: GoldenCandidate['platform'],
  format: GoldenCandidate['format'],
  day: number,
): GoldenCandidate => ({ id, platform, format, goldenAt: new Date(Date.UTC(2026, 9, day)) });

const pool = [
  c('x-thread', 'X', 'THREAD', 1),
  c('ig-post-old', 'INSTAGRAM', 'POST', 2),
  c('ig-post-new', 'INSTAGRAM', 'POST', 9),
  c('ig-reel', 'INSTAGRAM', 'CAROUSEL', 5),
  c('li-post', 'LINKEDIN', 'POST', 7),
];

describe('pickGoldenExamples', () => {
  it('puts the same platform and format first, newest mark first inside a group', () => {
    const got = pickGoldenExamples(pool, { platform: 'INSTAGRAM', format: 'POST' }, 4);
    expect(got.map((x) => x.id)).toEqual(['ig-post-new', 'ig-post-old', 'ig-reel', 'li-post']);
  });

  it('then the same platform, then the same format, then the rest', () => {
    const got = pickGoldenExamples(pool, { platform: 'X', format: 'POST' }, 5).map((x) => x.id);
    // X/THREAD (platform matches) first; the other platforms with format POST tie, newest mark first
    expect(got).toEqual(['x-thread', 'ig-post-new', 'li-post', 'ig-post-old', 'ig-reel']);
  });

  it('takes at most K, none for K = 0, and leaves out the excluded ids', () => {
    expect(pickGoldenExamples(pool, { platform: 'INSTAGRAM', format: 'POST' }, 1)).toHaveLength(1);
    expect(pickGoldenExamples(pool, { platform: 'INSTAGRAM', format: 'POST' }, 0)).toEqual([]);
    const got = pickGoldenExamples(
      pool,
      { platform: 'INSTAGRAM', format: 'POST', excludeIds: ['ig-post-new'] },
      2,
    );
    expect(got.map((x) => x.id)).toEqual(['ig-post-old', 'ig-reel']);
  });

  it('is deterministic and does not reorder its input', () => {
    const copy = [...pool];
    const a = pickGoldenExamples(pool, { platform: 'X', format: 'POST' }, 3);
    expect(pickGoldenExamples(pool, { platform: 'X', format: 'POST' }, 3)).toEqual(a);
    expect(pool).toEqual(copy);
  });
});

describe('GoldenSettingsSchema', () => {
  it('has defaults and bounds', () => {
    expect(GoldenSettingsSchema.parse({})).toEqual({ maxExamples: 2, maxChars: 1500 });
    expect(GoldenSettingsSchema.safeParse({ maxExamples: 4 }).success).toBe(false);
    expect(GoldenSettingsSchema.safeParse({ maxChars: 100 }).success).toBe(false);
    expect(GoldenSettingsSchema.parse({ maxExamples: 0 }).maxExamples).toBe(0);
  });
});
