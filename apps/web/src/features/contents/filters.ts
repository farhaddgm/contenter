import {
  ContentFormat,
  ContentSort,
  ContentStatus,
  Platform,
  ScheduleFilter,
  type ContentListQuery,
} from '@contenter/shared';

/**
 * The content list filters as they live in the URL, so a filtered list can be shared and the
 * back button works. Lists are comma-separated; dates are plain `YYYY-MM-DD` days.
 */
export interface ContentFilters {
  q: string;
  statuses: ContentStatus[];
  formats: ContentFormat[];
  platforms: Platform[];
  tagIds: string[];
  /** A campaign id, or `none` for contents in no campaign. */
  campaignId: string;
  schedule: ScheduleFilter | '';
  /** First and last day of the created range. */
  from: string;
  to: string;
  sort: ContentSort;
  order: 'asc' | 'desc';
  page: number;
}

export const DEFAULT_FILTERS: ContentFilters = {
  q: '',
  statuses: [],
  formats: [],
  platforms: [],
  tagIds: [],
  campaignId: '',
  schedule: '',
  from: '',
  to: '',
  sort: 'updated',
  order: 'desc',
  page: 1,
};

/** A list from `a,b,c`, keeping only values the enum allows. */
function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
}

const pick = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;

const day = (raw: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '');

export function readFilters(params: URLSearchParams): ContentFilters {
  const page = Number(params.get('page'));
  return {
    q: params.get('q') ?? '',
    statuses: list(params.get('statuses'), ContentStatus),
    formats: list(params.get('formats'), ContentFormat),
    platforms: list(params.get('platforms'), Platform),
    tagIds: (params.get('tagIds') ?? '').split(',').filter(Boolean),
    campaignId: params.get('campaignId') ?? '',
    schedule: pick(params.get('schedule'), ScheduleFilter, '' as ScheduleFilter | ''),
    from: day(params.get('from')),
    to: day(params.get('to')),
    sort: pick(params.get('sort'), ContentSort, DEFAULT_FILTERS.sort),
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The URL query for `filters`: only what differs from the defaults. */
export function writeFilters(filters: ContentFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => value && params.set(key, value);
  set('q', filters.q.trim());
  set('statuses', filters.statuses.join(','));
  set('formats', filters.formats.join(','));
  set('platforms', filters.platforms.join(','));
  set('tagIds', filters.tagIds.join(','));
  set('campaignId', filters.campaignId);
  set('schedule', filters.schedule);
  set('from', filters.from);
  set('to', filters.to);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/** How many filters narrow the list (sorting and paging do not count). */
export function activeFilterCount(f: ContentFilters): number {
  return [
    f.q.trim(),
    f.statuses.length,
    f.formats.length,
    f.platforms.length,
    f.tagIds.length,
    f.campaignId,
    f.schedule,
    f.from,
    f.to,
  ].filter(Boolean).length;
}

/** Local midnight and the last millisecond of that day, as ISO instants. */
const startOfDayIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDayIso = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

/** The parameters of `GET /contents`, which only takes plain strings and numbers. */
export function toApiParams(
  f: ContentFilters,
  extra: { topicId?: string; pageSize?: number } = {},
): ContentListQuery & Record<string, string | number | undefined> {
  const join = (v: string[]) => (v.length ? v.join(',') : undefined);
  return {
    page: f.page,
    pageSize: extra.pageSize ?? 20,
    topicId: extra.topicId,
    q: f.q.trim() || undefined,
    statuses: join(f.statuses),
    formats: join(f.formats),
    platforms: join(f.platforms),
    tagIds: join(f.tagIds),
    campaignId: f.campaignId || undefined,
    schedule: f.schedule || undefined,
    createdFrom: f.from ? startOfDayIso(f.from) : undefined,
    createdTo: f.to ? endOfDayIso(f.to) : undefined,
    sort: f.sort,
    order: f.order,
  } as ContentListQuery & Record<string, string | number | undefined>;
}
