import { describe, expect, it } from 'vitest';
import {
  BulkContentMetricsSchema,
  CreateContentMetricSchema,
  parseMetricsTable,
  summarizeMetrics,
} from './metrics';

const reading = (over: Record<string, unknown>) => ({
  measuredAt: '2026-10-01',
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  clicks: null,
  conversions: null,
  revenue: null,
  ...over,
});

describe('metric schemas', () => {
  it('needs at least one number', () => {
    expect(CreateContentMetricSchema.safeParse({}).success).toBe(false);
    expect(CreateContentMetricSchema.safeParse({ note: 'x' }).success).toBe(false);
    expect(CreateContentMetricSchema.safeParse({ views: 0 }).success).toBe(true);
  });

  it('rejects negative, fractional and absurd counters and bad dates', () => {
    for (const bad of [{ views: -1 }, { likes: 1.5 }, { views: 3_000_000_000 }]) {
      expect(CreateContentMetricSchema.safeParse(bad).success).toBe(false);
    }
    expect(CreateContentMetricSchema.safeParse({ views: 1, measuredAt: '2026-13-40' }).success).toBe(false);
    expect(CreateContentMetricSchema.safeParse({ views: 1, measuredAt: '1405-07-21' }).success).toBe(true);
    expect(CreateContentMetricSchema.safeParse({ views: 1, revenue: 1.5 }).success).toBe(true);
  });

  it('limits a bulk request', () => {
    const row = { measuredAt: '2026-10-01', views: 1 };
    expect(BulkContentMetricsSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(BulkContentMetricsSchema.safeParse({ rows: Array(367).fill(row) }).success).toBe(false);
    expect(BulkContentMetricsSchema.safeParse({ rows: [row] }).success).toBe(true);
  });
});

describe('summarizeMetrics', () => {
  it('is empty without readings', () => {
    expect(summarizeMetrics([])).toMatchObject({ readings: 0, latest: null, engagementRate: null });
  });

  it('uses the latest reading and derives rates from it', () => {
    const s = summarizeMetrics([
      reading({ measuredAt: '2026-10-05', views: 1000, likes: 40, comments: 10, saves: 50, clicks: 25 }),
      reading({ measuredAt: '2026-10-02', views: 100, likes: 5 }),
    ]);
    expect(s.readings).toBe(2);
    expect(s.latestAt).toBe('2026-10-05');
    expect(s.engagement).toBe(100);
    expect(s.engagementRate).toBe(0.1);
    expect(s.clickRate).toBe(0.025);
  });

  it('gives no rate without views, and no engagement when nothing is known', () => {
    const s = summarizeMetrics([reading({ likes: 3 })]);
    expect(s.engagement).toBe(3);
    expect(s.engagementRate).toBeNull();
    expect(summarizeMetrics([reading({ views: 10 })]).engagement).toBeNull();
  });
});

describe('parseMetricsTable', () => {
  it('reads a tab-separated table with English headers', () => {
    const r = parseMetricsTable('date\tviews\tlikes\n2026-10-01\t100\t5\n2026-10-02\t250\t9');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { measuredAt: '2026-10-01', views: 100, likes: 5 },
      { measuredAt: '2026-10-02', views: 250, likes: 9 },
    ]);
  });

  it('reads Persian headers, Persian digits, thousand separators and "/" dates', () => {
    const r = parseMetricsTable('تاریخ،بازدید،لایک،ذخیره،درآمد\n۲۰۲۶/۱۰/۰۱،۱٬۲۰۰،۸۰،۱۲،۱٬۵۰۰٬۰۰۰');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { measuredAt: '2026-10-01', views: 1200, likes: 80, saves: 12, revenue: 1500000 },
    ]);
  });

  it('accepts k and m shorthand and treats a dash as unknown', () => {
    const r = parseMetricsTable('date,views,likes\n2026-10-01,12.5k,-');
    expect(r.rows).toEqual([{ measuredAt: '2026-10-01', views: 12500 }]);
  });

  it('uses the default day when there is no date column', () => {
    const r = parseMetricsTable('views,likes\n10,2', '2026-10-09');
    expect(r.rows).toEqual([{ measuredAt: '2026-10-09', views: 10, likes: 2 }]);
    expect(parseMetricsTable('views,likes\n10,2').errors).toEqual([{ line: 0, message: 'NO_DATE_COLUMN' }]);
  });

  it('refuses Jalali dates instead of guessing', () => {
    const r = parseMetricsTable('تاریخ,بازدید\n۱۴۰۵/۰۷/۱۰,100');
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 2, message: 'JALALI_DATE' }]);
  });

  it('reports bad cells with their line and keeps the good rows', () => {
    const r = parseMetricsTable('date,views,likes\n2026-10-01,abc,5\n2026-10-02,10,3\n2026-10-03,,\n2026-10-04,1.5,1');
    expect(r.rows).toEqual([{ measuredAt: '2026-10-02', views: 10, likes: 3 }]);
    expect(r.errors).toEqual([
      { line: 2, message: 'BAD_NUMBER:views' },
      { line: 4, message: 'NO_NUMBERS' },
      { line: 5, message: 'BAD_NUMBER:views' },
    ]);
  });

  it('keeps the later line when a day repeats, and says so', () => {
    const r = parseMetricsTable('date,views\n2026-10-01,5\n2026-10-01,9');
    expect(r.rows).toEqual([{ measuredAt: '2026-10-01', views: 9 }]);
    expect(r.errors).toEqual([{ line: 0, message: 'DUPLICATE_DAY:2026-10-01' }]);
  });

  it('rejects empty input and a header without number columns', () => {
    expect(parseMetricsTable('  \n ').errors).toEqual([{ line: 0, message: 'EMPTY' }]);
    expect(parseMetricsTable('date,foo\n2026-10-01,1').errors).toEqual([
      { line: 0, message: 'NO_NUMBER_COLUMNS' },
    ]);
  });
});
