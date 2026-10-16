/**
 * Content coverage map (docs/50-coverage-map.md): which content pillars of a business were
 * actually covered by approved or published content, by platform or by 30-day period. Everything
 * is counted by code from labels people set; the model labels nothing. Unlabeled content has its
 * own row, so the numbers never pretend to be complete.
 */
import { z } from 'zod';
import { Platform } from './enums';

export const PILLAR_MAX = 12;
export const PILLAR_NAME_MAX = 60;
/** A pillar with no content in this many days gets the warning colour (default). */
export const DEFAULT_STALE_DAYS = 30;
/** Under this many labeled contents the shares are not compared with the targets. */
export const MIN_LABELED_FOR_SHARE = 5;
export const COVERAGE_PERIODS = [30, 90, 180] as const;
export const COVERAGE_PERIOD_DAYS = 30;

export const PillarInputSchema = z.object({
  /** Kept when a pillar is renamed, so its contents stay attached. */
  id: z.string().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(PILLAR_NAME_MAX),
  /** Wanted share of the labeled content, in percent. */
  targetShare: z.number().int().min(0).max(100).nullable().default(null),
});
export type PillarInput = z.input<typeof PillarInputSchema>;

const pillarKey = (s: string) => s.trim().toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');

export const SavePillarsSchema = z
  .object({ pillars: z.array(PillarInputSchema).max(PILLAR_MAX) })
  .refine((v) => new Set(v.pillars.map((p) => pillarKey(p.name))).size === v.pillars.length, {
    message: 'Two pillars have the same name',
    path: ['pillars'],
  })
  .refine((v) => v.pillars.reduce((n, p) => n + (p.targetShare ?? 0), 0) <= 100, {
    message: 'The target shares add up to more than 100',
    path: ['pillars'],
  });
export type SavePillarsInput = z.input<typeof SavePillarsSchema>;

export interface ContentPillar {
  id: string;
  name: string;
  targetShare: number | null;
  order: number;
}

export const CoverageBy = ['platform', 'period'] as const;
export type CoverageBy = (typeof CoverageBy)[number];

export const CoverageQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((n) => (COVERAGE_PERIODS as readonly number[]).includes(n), 'Unsupported period')
    .default(90),
  by: z.enum(CoverageBy).default('platform'),
  staleDays: z.coerce.number().int().min(1).max(365).default(DEFAULT_STALE_DAYS),
});
export type CoverageQuery = z.infer<typeof CoverageQuerySchema>;

export interface CoverageRow {
  /** Null = content without a pillar. */
  pillarId: string | null;
  name: string | null;
  targetShare: number | null;
  /** One count per column. */
  counts: number[];
  total: number;
  /** Share of the labeled content in percent; null for the unlabeled row or too few labeled. */
  share: number | null;
  /** Target minus actual share, in points (positive = behind). Null without a target or share. */
  gap: number | null;
  /** The newest content of this pillar, within `max(days, staleDays)`. */
  lastAt: string | null;
  daysSince: number | null;
  /** Nothing for `staleDays` days (a pillar without any content is stale too). */
  stale: boolean;
}

export interface CoverageReport {
  days: number;
  by: CoverageBy;
  staleDays: number;
  /** Platform keys, or `P0` (the latest 30 days), `P1`… going back. */
  columns: string[];
  rows: CoverageRow[];
  /** Counted contents in the window, with or without a pillar. */
  total: number;
  labeled: number;
  /** Enough labeled content to compare shares with the targets. */
  enoughLabeled: boolean;
}

export interface CoverageItem {
  pillarId: string | null;
  platform: Platform;
  /** When the content counts: published, else scheduled, else created. */
  at: Date;
}

const DAY = 86_400_000;

/**
 * Pure: pillars × (platform | 30-day period) over approved and published contents. `items` should
 * reach back `max(days, staleDays)` days; those older than `days` only feed "last content". A
 * pillar id not in `pillars` (a deleted one) counts as unlabeled.
 */
export function buildCoverage(
  pillars: readonly ContentPillar[],
  items: readonly CoverageItem[],
  opts: { days: number; by: CoverageBy; staleDays: number; now: Date },
): CoverageReport {
  const { days, by, staleDays, now } = opts;
  const known = new Set(pillars.map((p) => p.id));
  const periods = Math.max(1, Math.ceil(days / COVERAGE_PERIOD_DAYS));
  const columns =
    by === 'platform' ? [...Platform] : Array.from({ length: periods }, (_, i) => `P${i}`);
  const colOf = (i: CoverageItem): number => {
    if (by === 'platform') return columns.indexOf(i.platform);
    const age = Math.floor((now.getTime() - i.at.getTime()) / (COVERAGE_PERIOD_DAYS * DAY));
    return age >= 0 && age < periods ? age : -1;
  };

  const rows = [...pillars]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((p) => blank(p.id, p.name, p.targetShare, columns.length));
  const unlabeled = blank(null, null, null, columns.length);
  const byId = new Map(rows.map((r) => [r.pillarId, r]));
  const windowStart = now.getTime() - days * DAY;

  const last = new Map<string | null, Date>();
  for (const item of items) {
    const key = item.pillarId && known.has(item.pillarId) ? item.pillarId : null;
    const row = key ? byId.get(key)! : unlabeled;
    const seen = last.get(key);
    if (!seen || item.at > seen) last.set(key, item.at);
    if (item.at.getTime() < windowStart || item.at.getTime() > now.getTime()) continue;
    const c = colOf(item);
    if (c < 0) continue;
    row.counts[c]!++;
    row.total++;
  }

  const labeled = rows.reduce((n, r) => n + r.total, 0);
  const enoughLabeled = labeled >= MIN_LABELED_FOR_SHARE;
  for (const row of [...rows, unlabeled]) {
    const at = last.get(row.pillarId) ?? null;
    row.lastAt = at ? at.toISOString() : null;
    row.daysSince = at ? Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY)) : null;
    // only a pillar can be stale; "no pillar" has nothing to cover
    row.stale = row.pillarId !== null && (row.daysSince === null || row.daysSince >= staleDays);
    if (row.pillarId !== null && enoughLabeled) {
      row.share = Math.round((row.total / labeled) * 100);
      row.gap = row.targetShare === null ? null : row.targetShare - row.share;
    }
  }
  return {
    days,
    by,
    staleDays,
    columns,
    rows: [...rows, unlabeled],
    total: labeled + unlabeled.total,
    labeled,
    enoughLabeled,
  };
}

function blank(
  pillarId: string | null,
  name: string | null,
  targetShare: number | null,
  columns: number,
): CoverageRow {
  return {
    pillarId,
    name,
    targetShare,
    counts: Array<number>(columns).fill(0),
    total: 0,
    share: null,
    gap: null,
    lastAt: null,
    daysSince: null,
    stale: false,
  };
}
