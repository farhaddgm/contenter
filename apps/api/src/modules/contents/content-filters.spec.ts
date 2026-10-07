import { describe, expect, it } from 'vitest';
import { ContentListQuerySchema } from '@contenter/shared';
import { buildContentOrderBy, buildContentWhere } from './content-filters';

const parse = (raw: Record<string, string> = {}) => ContentListQuerySchema.parse(raw);
const NOW = new Date('2026-10-10T12:00:00Z');

/** The conditions of the top-level AND, for readable assertions. */
const conditions = (raw: Record<string, string>, visible?: object) => {
  const where = buildContentWhere(parse(raw), visible, NOW);
  return ('AND' in where ? (where.AND as object[]) : []) as Record<string, unknown>[];
};

describe('buildContentWhere', () => {
  it('has no conditions for an unfiltered admin list', () => {
    expect(buildContentWhere(parse(), undefined, NOW)).toEqual({});
  });

  it('limits everything to the topics the caller can see', () => {
    expect(conditions({}, { createdById: 'u1' })).toEqual([{ topic: { createdById: 'u1' } }]);
  });

  it('merges the old single status with the new list', () => {
    expect(conditions({ status: 'DRAFT', statuses: 'APPROVED,IN_REVIEW' })).toEqual([
      { status: { in: ['APPROVED', 'IN_REVIEW', 'DRAFT'] } },
    ]);
  });

  it('filters by format', () => {
    expect(conditions({ formats: 'THREAD,POST' })).toEqual([
      { format: { in: ['THREAD', 'POST'] } },
    ]);
  });

  it('reads the platform a content is for: its own, else its topic’s', () => {
    expect(conditions({ platforms: 'X,TELEGRAM' })).toEqual([
      {
        OR: [
          { platform: { in: ['X', 'TELEGRAM'] } },
          { platform: null, topic: { platform: { in: ['X', 'TELEGRAM'] } } },
        ],
      },
    ]);
  });

  it('matches any of several tags, including the old single tagId', () => {
    expect(conditions({ tagIds: 'a,b', tagId: 'c' })).toEqual([
      { tags: { some: { id: { in: ['a', 'b', 'c'] } } } },
    ]);
  });

  it('finds the contents of a campaign, or of none', () => {
    expect(conditions({ campaignId: 'k1' })).toEqual([{ campaignId: 'k1' }]);
    expect(conditions({ campaignId: 'none' })).toEqual([{ campaignId: null }]);
  });

  it('filters by author and by the created range', () => {
    expect(
      conditions({
        createdById: 'u2',
        createdFrom: '2026-10-01T00:00:00.000Z',
        createdTo: '2026-10-08T00:00:00.000Z',
      }),
    ).toEqual([
      { createdById: 'u2' },
      {
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-08T00:00:00.000Z'),
        },
      },
    ]);
  });

  it('turns the publishing plan filters into conditions', () => {
    expect(conditions({ schedule: 'planned' })).toEqual([
      { scheduledAt: { not: null }, publishedAt: null },
    ]);
    expect(conditions({ schedule: 'unplanned' })).toEqual([
      { status: 'APPROVED', scheduledAt: null, publishedAt: null },
    ]);
    expect(conditions({ schedule: 'overdue' })).toEqual([
      { scheduledAt: { lt: NOW }, publishedAt: null },
    ]);
    expect(conditions({ schedule: 'published' })).toEqual([{ publishedAt: { not: null } }]);
  });

  it('wants every word of the text query, in any keyboard spelling', () => {
    const [words] = conditions({ q: 'علی کتاب' });
    const and = words!.AND as { OR: Record<string, unknown>[] }[];
    expect(and).toHaveLength(2);
    // the first word is looked for as ی and as ي, in the title among other fields
    const titles = and[0]!.OR.filter((c) => 'title' in c).map(
      (c) => (c.title as { contains: string }).contains,
    );
    expect(titles).toEqual(expect.arrayContaining(['علی', 'علي']));
    // and inside the current draft too
    expect(and[0]!.OR.some((c) => 'currentVersion' in c)).toBe(true);
  });

  it('ignores a query that is only punctuation', () => {
    expect(conditions({ q: ' ?! ' })).toEqual([]);
  });

  it('combines everything with AND, so filters narrow each other', () => {
    expect(conditions({ statuses: 'DRAFT', formats: 'POST', schedule: 'planned' })).toHaveLength(3);
  });
});

describe('buildContentOrderBy', () => {
  it('sorts by last change by default, newest first', () => {
    expect(buildContentOrderBy('updated', 'desc')).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }]);
  });

  it('sorts by creation date and by title in either direction', () => {
    expect(buildContentOrderBy('created', 'asc')[0]).toEqual({ createdAt: 'asc' });
    expect(buildContentOrderBy('title', 'asc')[0]).toEqual({ title: 'asc' });
  });

  it('puts contents without a plan last whichever way the plan is sorted', () => {
    for (const order of ['asc', 'desc'] as const) {
      expect(buildContentOrderBy('scheduled', order)[0]).toEqual({
        scheduledAt: { sort: order, nulls: 'last' },
      });
    }
  });
});
