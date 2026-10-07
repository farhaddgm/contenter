import { describe, expect, it } from 'vitest';
import { ContentListQuerySchema } from '@contenter/shared';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  readFilters,
  toApiParams,
  writeFilters,
  type ContentFilters,
} from './filters';

const read = (qs: string) => readFilters(new URLSearchParams(qs));
const f = (over: Partial<ContentFilters>): ContentFilters => ({ ...DEFAULT_FILTERS, ...over });

describe('readFilters', () => {
  it('starts from the defaults for an empty query', () => {
    expect(read('')).toEqual(DEFAULT_FILTERS);
  });

  it('reads lists, and drops values that are not in the enum', () => {
    const r = read('statuses=DRAFT,NOPE,APPROVED&formats=THREAD&platforms=X,MYSPACE&tagIds=a,,b');
    expect(r.statuses).toEqual(['DRAFT', 'APPROVED']);
    expect(r.formats).toEqual(['THREAD']);
    expect(r.platforms).toEqual(['X']);
    expect(r.tagIds).toEqual(['a', 'b']);
  });

  it('falls back for a bad sort, schedule, day or page', () => {
    const r = read('sort=price&schedule=soon&from=yesterday&page=-3&order=sideways');
    expect(r).toMatchObject({ sort: 'updated', schedule: '', from: '', page: 1, order: 'desc' });
    expect(read('page=4').page).toBe(4);
    expect(read('schedule=overdue&sort=title&order=asc&from=2026-10-01')).toMatchObject({
      schedule: 'overdue',
      sort: 'title',
      order: 'asc',
      from: '2026-10-01',
    });
  });
});

describe('writeFilters', () => {
  it('writes nothing for the defaults, so the URL stays clean', () => {
    expect(writeFilters(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('round-trips every filter', () => {
    const all = f({
      q: 'سرمایه',
      statuses: ['DRAFT', 'IN_REVIEW'],
      formats: ['POST'],
      platforms: ['X', 'LINKEDIN'],
      tagIds: ['t1', 't2'],
      campaignId: 'none',
      schedule: 'planned',
      from: '2026-10-01',
      to: '2026-10-08',
      sort: 'scheduled',
      order: 'asc',
      page: 3,
    });
    expect(readFilters(writeFilters(all))).toEqual(all);
  });

  it('keeps sorting and the page only when they differ from the defaults', () => {
    expect(writeFilters(f({ sort: 'title' })).toString()).toBe('sort=title');
    expect(writeFilters(f({ page: 2 })).toString()).toBe('page=2');
  });
});

describe('activeFilterCount', () => {
  it('counts narrowing filters but not sorting or paging', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount(f({ sort: 'title', order: 'asc', page: 5 }))).toBe(0);
    expect(activeFilterCount(f({ q: ' ', statuses: ['DRAFT'], from: '2026-10-01' }))).toBe(2);
    expect(
      activeFilterCount(f({ q: 'x', formats: ['POST'], platforms: ['X'], campaignId: 'none' })),
    ).toBe(4);
  });
});

describe('toApiParams', () => {
  it('sends only plain strings, with the lists joined', () => {
    const p = toApiParams(f({ statuses: ['DRAFT', 'APPROVED'], tagIds: ['a'], q: ' کتاب ' }), {
      topicId: 't1',
      pageSize: 50,
    });
    expect(p).toMatchObject({
      topicId: 't1',
      pageSize: 50,
      q: 'کتاب',
      statuses: 'DRAFT,APPROVED',
      tagIds: 'a',
      formats: undefined,
      sort: 'updated',
      order: 'desc',
    });
  });

  it('turns a day range into the whole first and last day', () => {
    const p = toApiParams(f({ from: '2026-10-01', to: '2026-10-08' }));
    expect(new Date(p.createdFrom as string)).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(new Date(p.createdTo as string)).toEqual(new Date(2026, 9, 8, 23, 59, 59, 999));
  });

  it('is accepted by the API’s own schema', () => {
    const all = f({
      q: 'سرمایه',
      statuses: ['DRAFT', 'IN_REVIEW'],
      formats: ['POST', 'THREAD'],
      platforms: ['X'],
      tagIds: ['t1'],
      campaignId: 'none',
      schedule: 'overdue',
      from: '2026-10-01',
      to: '2026-10-08',
      sort: 'scheduled',
      order: 'asc',
    });
    const params = Object.fromEntries(
      Object.entries(toApiParams(all, { topicId: 't1' })).filter(([, v]) => v !== undefined),
    );
    expect(ContentListQuerySchema.safeParse(params).success).toBe(true);
  });
});
