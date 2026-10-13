/**
 * Manual performance numbers of a published content (docs/32-performance-metrics.md).
 *
 * The admin reads the numbers from the platform and types or pastes them; nothing here calls a
 * platform. One reading per content and day (re-entering the day replaces it). The counters are
 * cumulative, so the latest reading is the current state of the post.
 */
import { z } from 'zod';
import { normalizeDigits } from './quality';

/** The numbers a reading can hold, in display order. */
export const METRIC_FIELDS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'clicks',
  'conversions',
  'revenue',
] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

/** Counters that make up "engagement"; views and money are not engagement. */
export const ENGAGEMENT_FIELDS = ['likes', 'comments', 'shares', 'saves'] as const;

/** Most readings one bulk request may carry. */
export const MAX_BULK_METRICS = 366;

const isoDay = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Not a real date');

const count = z.number().int().min(0).max(2_000_000_000);

const metricNumbers = {
  views: count.nullable().optional(),
  likes: count.nullable().optional(),
  comments: count.nullable().optional(),
  shares: count.nullable().optional(),
  saves: count.nullable().optional(),
  clicks: count.nullable().optional(),
  conversions: count.nullable().optional(),
  /** Money made from the post, in the business's currency. */
  revenue: z.number().min(0).max(1e13).nullable().optional(),
};

const hasNumber = (v: Partial<Record<MetricField, number | null | undefined>>) =>
  METRIC_FIELDS.some((f) => typeof v[f] === 'number');

export const CreateContentMetricSchema = z
  .object({
    /** The day the numbers were read; defaults to today on the server. */
    measuredAt: isoDay.optional(),
    ...metricNumbers,
    note: z.string().trim().max(500).optional().default(''),
  })
  .refine(hasNumber, { message: 'Enter at least one number' });
export type CreateContentMetricInput = z.input<typeof CreateContentMetricSchema>;

export const UpdateContentMetricSchema = z
  .object({
    measuredAt: isoDay.optional(),
    ...metricNumbers,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type UpdateContentMetricInput = z.input<typeof UpdateContentMetricSchema>;

export const BulkContentMetricsSchema = z.object({
  rows: z
    .array(
      z
        .object({ measuredAt: isoDay, ...metricNumbers, note: z.string().trim().max(500).optional().default('') })
        .refine(hasNumber, { message: 'Enter at least one number' }),
    )
    .min(1)
    .max(MAX_BULK_METRICS),
});
export type BulkContentMetricsInput = z.input<typeof BulkContentMetricsSchema>;

export interface ContentMetric {
  id: string;
  contentId: string;
  /** YYYY-MM-DD. */
  measuredAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  note: string;
  createdBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Latest reading plus the numbers derived from it. */
export interface ContentMetricSummary {
  readings: number;
  latest: ContentMetric | null;
  /** Likes + comments + shares + saves of the latest reading; null when none is known. */
  engagement: number | null;
  /** engagement ÷ views; null without views. A rough indicator, not an industry metric. */
  engagementRate: number | null;
  /** clicks ÷ views; null without both. */
  clickRate: number | null;
}

const ratio = (a: number | null, b: number | null | undefined) =>
  a !== null && b ? Math.round((a / b) * 10_000) / 10_000 : null;

/** The summary of readings in any order. Pure: used by the API and by the learning loop. */
export function summarizeMetrics(
  rows: readonly Pick<ContentMetric, 'measuredAt' | MetricField>[],
): ContentMetricSummary & { latestAt: string | null } {
  if (!rows.length) {
    return {
      readings: 0,
      latest: null,
      latestAt: null,
      engagement: null,
      engagementRate: null,
      clickRate: null,
    };
  }
  const latest = [...rows].sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1))[0];
  const known = ENGAGEMENT_FIELDS.map((f) => latest[f]).filter((v): v is number => v !== null);
  const engagement = known.length ? known.reduce((s, n) => s + n, 0) : null;
  return {
    readings: rows.length,
    latest: latest as ContentMetric,
    latestAt: latest.measuredAt,
    engagement,
    engagementRate: ratio(engagement, latest.views),
    clickRate: ratio(latest.clicks, latest.views),
  };
}

// ─────────────────────────────── pasted tables ───────────────────────────────

/** Header words (normalized, lower case) → field. Persian and English spellings. */
const HEADER_ALIASES: Record<string, MetricField | 'date' | 'note'> = {
  date: 'date',
  day: 'date',
  measuredat: 'date',
  تاریخ: 'date',
  روز: 'date',
  views: 'views',
  view: 'views',
  بازدید: 'views',
  نمایش: 'views',
  مشاهده: 'views',
  likes: 'likes',
  like: 'likes',
  لایک: 'likes',
  'پسندیدن': 'likes',
  comments: 'comments',
  comment: 'comments',
  کامنت: 'comments',
  نظر: 'comments',
  دیدگاه: 'comments',
  shares: 'shares',
  share: 'shares',
  'اشتراک‌گذاری': 'shares',
  اشتراکگذاری: 'shares',
  شیر: 'shares',
  بازنشر: 'shares',
  saves: 'saves',
  save: 'saves',
  ذخیره: 'saves',
  clicks: 'clicks',
  click: 'clicks',
  کلیک: 'clicks',
  conversions: 'conversions',
  conversion: 'conversions',
  فروش: 'conversions',
  تبدیل: 'conversions',
  revenue: 'revenue',
  income: 'revenue',
  درآمد: 'revenue',
  note: 'note',
  یادداشت: 'note',
  توضیح: 'note',
};

export interface ParsedMetricRow extends Partial<Record<MetricField, number>> {
  measuredAt: string;
  note?: string;
}

export interface ParsedMetrics {
  rows: ParsedMetricRow[];
  /** One message per problem, with the 1-based line it belongs to (0 = the header). */
  errors: { line: number; message: string }[];
}

const normalizeHeader = (h: string) =>
  h
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\s_\-.:]+/g, '')
    .replace(/‌/g, '')
    .toLowerCase();

const ALIASES = new Map(
  Object.entries(HEADER_ALIASES).map(([k, v]) => [normalizeHeader(k), v] as const),
);

function detectDelimiter(line: string): string {
  const candidates = ['\t', ';', '؛', ',', '،'];
  let best = ',';
  let max = 0;
  for (const c of candidates) {
    const n = line.split(c).length - 1;
    if (n > max) {
      max = n;
      best = c;
    }
  }
  return best;
}

function parseNumberCell(raw: string): number | null | 'bad' {
  const t = normalizeDigits(raw).trim().replace(/[\s,]/g, '').replace(/٬/g, '');
  if (!t || t === '-' || t === '—') return null;
  // 12.5k / 1.2m shorthand some dashboards export
  const m = t.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!m) return 'bad';
  const mult = m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'bad';
}

/**
 * Turns a table pasted from a spreadsheet or exported as CSV into readings. The first line must
 * name the columns (English or Persian: "تاریخ، بازدید، لایک…"); a "date" column is required
 * unless `defaultDay` is given, and then every row without one gets that day. Dates are
 * Gregorian `YYYY-MM-DD` (also with `/`, and with Persian digits); Jalali dates are refused
 * with a clear message instead of being guessed.
 */
export function parseMetricsTable(input: string, defaultDay?: string): ParsedMetrics {
  const lines = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const errors: ParsedMetrics['errors'] = [];
  if (!lines.length) return { rows: [], errors: [{ line: 0, message: 'EMPTY' }] };

  const delimiter = detectDelimiter(lines[0]);
  const split = (l: string) => l.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const columns = split(lines[0]).map((h) => ALIASES.get(normalizeHeader(h)) ?? null);
  if (!columns.some((c) => c && c !== 'date' && c !== 'note')) {
    return { rows: [], errors: [{ line: 0, message: 'NO_NUMBER_COLUMNS' }] };
  }
  if (!columns.includes('date') && !defaultDay) {
    return { rows: [], errors: [{ line: 0, message: 'NO_DATE_COLUMN' }] };
  }

  const rows: ParsedMetricRow[] = [];
  lines.slice(1).forEach((line, idx) => {
    const lineNo = idx + 2;
    const cells = split(line);
    const row: ParsedMetricRow = { measuredAt: defaultDay ?? '' };
    let bad = false;
    columns.forEach((col, i) => {
      const cell = cells[i] ?? '';
      if (!col) return;
      if (col === 'note') {
        if (cell) row.note = cell.slice(0, 500);
        return;
      }
      if (col === 'date') {
        if (!cell) return;
        const d = normalizeDigits(cell).replace(/\//g, '-');
        const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!m) {
          errors.push({ line: lineNo, message: 'BAD_DATE' });
          bad = true;
          return;
        }
        if (Number(m[1]) < 1700) {
          errors.push({ line: lineNo, message: 'JALALI_DATE' });
          bad = true;
          return;
        }
        const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
          errors.push({ line: lineNo, message: 'BAD_DATE' });
          bad = true;
          return;
        }
        row.measuredAt = iso;
        return;
      }
      const n = parseNumberCell(cell);
      if (n === 'bad') {
        errors.push({ line: lineNo, message: `BAD_NUMBER:${col}` });
        bad = true;
      } else if (n !== null) {
        if (col !== 'revenue' && !Number.isInteger(n)) {
          errors.push({ line: lineNo, message: `BAD_NUMBER:${col}` });
          bad = true;
        } else row[col] = n;
      }
    });
    if (bad) return;
    if (!row.measuredAt) {
      errors.push({ line: lineNo, message: 'BAD_DATE' });
      return;
    }
    if (!METRIC_FIELDS.some((f) => typeof row[f] === 'number')) {
      errors.push({ line: lineNo, message: 'NO_NUMBERS' });
      return;
    }
    rows.push(row);
  });

  // the same day twice in one paste: the later line wins, and the user is told
  const seen = new Map<string, number>();
  const deduped: ParsedMetricRow[] = [];
  for (const r of rows) {
    const at = seen.get(r.measuredAt);
    if (at !== undefined) {
      deduped[at] = r;
      errors.push({ line: 0, message: `DUPLICATE_DAY:${r.measuredAt}` });
    } else {
      seen.set(r.measuredAt, deduped.length);
      deduped.push(r);
    }
  }
  return { rows: deduped.slice(0, MAX_BULK_METRICS), errors };
}
