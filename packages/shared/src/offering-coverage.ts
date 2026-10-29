/**
 * Coverage of the catalog by content (docs/73 §6 E and N, docs/67 §4.8): which offerings — and which
 * offering × audience pairs — were actually written about in the last 30 / 60 / 90 days. Counted by
 * code from the focus people set (`effectiveFocus`: a content's own offering/audience, else its
 * project's); the model labels nothing. Content without any offering has its own count, so the
 * numbers never pretend to be complete. An offering that cannot be sold, or is marked "do not
 * promote", is never called "uncovered".
 */
import { z } from 'zod';
import { isOfferingAvailable, type OfferingCore } from './business-catalog';
import { orderOfferingTree } from './offering-tree';

export const OFFERING_COVERAGE_WINDOWS = [30, 60, 90] as const;
export type OfferingCoverageWindow = (typeof OFFERING_COVERAGE_WINDOWS)[number];
/** An offering with no content in this many days is flagged (default). */
export const DEFAULT_OFFERING_STALE_DAYS = 30;

export const OfferingCoverageQuerySchema = z.object({
  staleDays: z.coerce.number().int().min(1).max(90).default(DEFAULT_OFFERING_STALE_DAYS),
});
export type OfferingCoverageQuery = z.infer<typeof OfferingCoverageQuerySchema>;

const DAY = 86_400_000;

/** One approved or published content, with its effective focus (already resolved). */
export interface CoverageContent {
  offeringId: string | null;
  segmentId: string | null;
  /** `publishedAt ?? scheduledAt ?? createdAt`. */
  at: Date | string;
}

export interface CoverageSegment {
  id: string;
  name: string;
  kind: string;
}

export interface CoverageLink {
  offeringId: string;
  segmentId: string;
  fit: number;
}

/** Counts in the three windows, newest window nested in the older ones. */
export type WindowCounts = Record<OfferingCoverageWindow, number>;

export interface OfferingCoverageRow {
  offeringId: string;
  name: string;
  parentId: string | null;
  /** 0 = a line or a lone offering. */
  depth: number;
  /** Can be sold today and is not marked "do not promote". */
  promotable: boolean;
  /** Contents about this offering itself. */
  own: WindowCounts;
  /** Contents about it or any of its variants. */
  subtree: WindowCounts;
  /** Newest content about it or its variants, within 90 days. */
  lastAt: string | null;
  daysSince: number | null;
  /** Promotable and nothing about it or its variants for `staleDays` days. */
  stale: boolean;
}

export interface OfferingMatrixCell {
  offeringId: string;
  segmentId: string;
  /** The admin linked this audience to the offering. */
  linked: boolean;
  /** 2 = main, 1 = secondary, 0 = not linked. */
  fit: number;
  /** Contents in the last 90 days with exactly this offering and audience. */
  count: number;
  lastAt: string | null;
  /** Linked, the offering is promotable, and no content for it in 90 days. */
  gap: boolean;
}

export interface OfferingCoverageReport {
  windows: readonly OfferingCoverageWindow[];
  staleDays: number;
  rows: OfferingCoverageRow[];
  segments: CoverageSegment[];
  /** Only pairs that are linked or have content. */
  cells: OfferingMatrixCell[];
  /** Contents of the last 90 days with no offering (neither their own nor their project's). */
  withoutOffering: WindowCounts;
  /** Contents of the last 90 days with an offering but no audience. */
  withoutAudience: number;
  total: number;
}

const emptyCounts = (): WindowCounts => ({ 30: 0, 60: 0, 90: 0 });

function addTo(counts: WindowCounts, ageDays: number) {
  for (const w of OFFERING_COVERAGE_WINDOWS) if (ageDays <= w) counts[w] += 1;
}

/**
 * Pure: the coverage of `offerings` (usable ones, in prompt order) and the offering × audience matrix
 * from `contents` (approved or published, newest 90 days). Rows come out as a tree, variants under
 * their line.
 */
export function buildOfferingCoverage(args: {
  offerings: readonly OfferingCore[];
  segments: readonly CoverageSegment[];
  links: readonly CoverageLink[];
  contents: readonly CoverageContent[];
  staleDays?: number;
  now?: Date;
}): OfferingCoverageReport {
  const now = args.now ?? new Date();
  const staleDays = args.staleDays ?? DEFAULT_OFFERING_STALE_DAYS;
  const maxWindow = OFFERING_COVERAGE_WINDOWS[OFFERING_COVERAGE_WINDOWS.length - 1]!;
  const offerings = args.offerings.filter((o): o is OfferingCore & { id: string } => !!o.id);
  const known = new Set(offerings.map((o) => o.id));
  const knownSegments = new Set(args.segments.map((s) => s.id));

  const ageOf = (at: Date | string) => (now.getTime() - new Date(at).getTime()) / DAY;
  const ownCounts = new Map<string, WindowCounts>();
  const last = new Map<string, number>();
  const pair = new Map<string, { count: number; last: number }>();
  const withoutOffering = emptyCounts();
  let withoutAudience = 0;
  let total = 0;

  for (const c of args.contents) {
    const age = ageOf(c.at);
    if (age > maxWindow) continue;
    // a future date (scheduled content) counts as today
    const days = Math.max(0, age);
    total += 1;
    if (!c.offeringId || !known.has(c.offeringId)) {
      addTo(withoutOffering, days);
      continue;
    }
    const counts = ownCounts.get(c.offeringId) ?? emptyCounts();
    addTo(counts, days);
    ownCounts.set(c.offeringId, counts);
    const at = new Date(c.at).getTime();
    last.set(c.offeringId, Math.max(last.get(c.offeringId) ?? 0, at));
    if (!c.segmentId || !knownSegments.has(c.segmentId)) {
      withoutAudience += 1;
      continue;
    }
    const key = `${c.offeringId}:${c.segmentId}`;
    const cell = pair.get(key) ?? { count: 0, last: 0 };
    pair.set(key, { count: cell.count + 1, last: Math.max(cell.last, at) });
  }

  const placed = orderOfferingTree(offerings);
  const children = new Map<string, string[]>();
  for (const { row } of placed) {
    if (row.parentId && known.has(row.parentId)) {
      children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
    }
  }
  const subtreeOf = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return [id, ...(children.get(id) ?? []).flatMap((c) => subtreeOf(c, seen))];
  };

  const rows: OfferingCoverageRow[] = placed.map(({ row: o, depth }) => {
    const ids = subtreeOf(o.id);
    const subtree = emptyCounts();
    let newest = 0;
    for (const id of ids) {
      const c = ownCounts.get(id);
      if (c) for (const w of OFFERING_COVERAGE_WINDOWS) subtree[w] += c[w];
      newest = Math.max(newest, last.get(id) ?? 0);
    }
    const daysSince = newest ? Math.max(0, Math.floor((now.getTime() - newest) / DAY)) : null;
    const promotable = isOfferingAvailable(o, now) && o.push > 0;
    return {
      offeringId: o.id,
      name: o.name,
      parentId: o.parentId && known.has(o.parentId) ? o.parentId : null,
      depth,
      promotable,
      own: ownCounts.get(o.id) ?? emptyCounts(),
      subtree,
      lastAt: newest ? new Date(newest).toISOString() : null,
      daysSince,
      stale: promotable && (daysSince === null || daysSince >= staleDays),
    };
  });

  const byOffering = new Map(rows.map((r) => [r.offeringId, r]));
  const cells = new Map<string, OfferingMatrixCell>();
  for (const l of args.links) {
    if (!known.has(l.offeringId) || !knownSegments.has(l.segmentId)) continue;
    const key = `${l.offeringId}:${l.segmentId}`;
    const hit = pair.get(key);
    cells.set(key, {
      offeringId: l.offeringId,
      segmentId: l.segmentId,
      linked: true,
      fit: l.fit,
      count: hit?.count ?? 0,
      lastAt: hit ? new Date(hit.last).toISOString() : null,
      gap: !hit && !!byOffering.get(l.offeringId)?.promotable,
    });
  }
  for (const [key, hit] of pair) {
    if (cells.has(key)) continue;
    const [offeringId = '', segmentId = ''] = key.split(':');
    cells.set(key, {
      offeringId,
      segmentId,
      linked: false,
      fit: 0,
      count: hit.count,
      lastAt: new Date(hit.last).toISOString(),
      gap: false,
    });
  }

  return {
    windows: OFFERING_COVERAGE_WINDOWS,
    staleDays,
    rows,
    segments: [...args.segments],
    cells: [...cells.values()].sort(
      (a, b) => a.offeringId.localeCompare(b.offeringId) || a.segmentId.localeCompare(b.segmentId),
    ),
    withoutOffering,
    withoutAudience,
    total,
  };
}
