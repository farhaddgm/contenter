/**
 * Competitor sources and the comparison with the business's own Instagram numbers
 * (docs/70-business-competitors.md, phase 2). Everything here is arithmetic on statistics code
 * already computed (`InstagramStats`): no model, no claim about the audience, and "not enough data"
 * under the same post count StyleFit uses.
 */
import { AddStyleSourceSchema, type StyleSourceSummary } from './business-style';
import type { InstagramStats } from './social';
import { MIN_INSTAGRAM_POSTS } from './style-fit';

/** Sources of one competitor (page, site, Instagram account or text). */
export const COMPETITOR_SOURCE_LIMIT = 3;

/** A competitor's source takes the same input and has the same summary as a style source. */
export const AddCompetitorSourceSchema = AddStyleSourceSchema;
export type CompetitorSourceSummary = StyleSourceSummary;

export type CompareState = 'OK' | 'TOO_FEW' | 'NONE';

export const COMPARE_METRICS = [
  'postsPerWeek',
  'avgCaptionChars',
  'avgEmojisPerPost',
  'avgHashtagsPerPost',
  'ctaShare',
  'questionShare',
  'persianShare',
  'engagementRatePct',
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

/** Metrics that are shares (0..1) and are shown as percentages. */
export const SHARE_METRICS: readonly CompareMetric[] = ['ctaShare', 'questionShare', 'persianShare'];

export interface CompareCompetitor {
  id: string;
  name: string;
  /** The competitor's latest Instagram statistics, or null when it has none. */
  stats: InstagramStats | null;
}

export interface CompareSubject {
  id: string;
  name: string;
  state: CompareState;
  /** Posts the numbers are based on. */
  posts: number;
}

export interface CompareRow {
  metric: CompareMetric;
  brand: number | null;
  /** One entry per competitor, in input order; null = no number (or not enough data). */
  values: { id: string; value: number | null }[];
  /** Range over the competitors that have a number; null when none does. */
  min: number | null;
  max: number | null;
  /** The engagement rate depends on follower counts, which differ a lot between accounts. */
  followerDependent: boolean;
}

export interface CompareReport {
  brand: { state: CompareState; posts: number };
  competitors: CompareSubject[];
  rows: CompareRow[];
  hashtags: {
    /** Hashtags the business and at least one competitor both use among their top ones. */
    shared: string[];
    /** Top hashtags of the competitors that the business does not use, with who uses them. */
    onlyTheirs: { tag: string; from: string[] }[];
    /** Jaccard overlap (0..1) of the business's and the competitors' top hashtags; null without both sides. */
    overlap: number | null;
  };
}

const stateOf = (s: InstagramStats | null): CompareState =>
  !s ? 'NONE' : s.postsAnalyzed < MIN_INSTAGRAM_POSTS ? 'TOO_FEW' : 'OK';

/** The number of a metric, or null when the source does not give it. */
export function metricValue(s: InstagramStats, metric: CompareMetric): number | null {
  switch (metric) {
    case 'postsPerWeek':
      return s.postsPerWeek;
    case 'avgCaptionChars':
      return s.avgCaptionChars;
    case 'avgEmojisPerPost':
      return s.avgEmojisPerPost;
    case 'avgHashtagsPerPost':
      return s.avgHashtagsPerPost;
    case 'ctaShare':
      return s.ctaShare;
    case 'questionShare':
      return s.questionShare;
    case 'persianShare':
      return s.scriptShare.persian;
    case 'engagementRatePct':
      return s.engagement?.ratePct ?? null;
  }
}

const foldTag = (tag: string) => tag.replace(/^#/, '').toLowerCase();

/**
 * Compares the business with its competitors metric by metric. A side with fewer than
 * `MIN_INSTAGRAM_POSTS` analyzed posts shows no numbers; the engagement rate is shown only when both
 * the business and the competitor have a follower-based rate. Pure and deterministic.
 */
export function compareBrands(args: {
  brand: InstagramStats | null;
  competitors: readonly CompareCompetitor[];
}): CompareReport {
  const brandState = stateOf(args.brand);
  const brand = brandState === 'OK' ? args.brand : null;
  const subjects: CompareSubject[] = args.competitors.map((c) => ({
    id: c.id,
    name: c.name,
    state: stateOf(c.stats),
    posts: c.stats?.postsAnalyzed ?? 0,
  }));
  const usable = args.competitors.filter((c) => stateOf(c.stats) === 'OK');

  const rows: CompareRow[] = COMPARE_METRICS.map((metric) => {
    const brandValue = brand ? metricValue(brand, metric) : null;
    const values = args.competitors.map((c) => {
      const ok = stateOf(c.stats) === 'OK';
      let value = ok && c.stats ? metricValue(c.stats, metric) : null;
      // a rate that depends on followers is only comparable when the business has one too
      if (metric === 'engagementRatePct' && brandValue === null) value = null;
      return { id: c.id, value };
    });
    const numbers = values.map((v) => v.value).filter((v): v is number => v !== null);
    return {
      metric,
      brand: brandValue,
      values,
      min: numbers.length ? Math.min(...numbers) : null,
      max: numbers.length ? Math.max(...numbers) : null,
      followerDependent: metric === 'engagementRatePct',
    };
  });

  const mine = new Set((brand?.topHashtags ?? []).map((h) => foldTag(h.tag)));
  const theirs = new Map<string, { tag: string; from: string[] }>();
  for (const c of usable) {
    for (const h of c.stats?.topHashtags ?? []) {
      const key = foldTag(h.tag);
      const entry = theirs.get(key) ?? { tag: h.tag, from: [] };
      if (!entry.from.includes(c.name)) entry.from.push(c.name);
      theirs.set(key, entry);
    }
  }
  const shared = [...theirs.keys()].filter((k) => mine.has(k)).sort();
  const union = new Set([...mine, ...theirs.keys()]);
  return {
    brand: { state: brandState, posts: args.brand?.postsAnalyzed ?? 0 },
    competitors: subjects,
    rows,
    hashtags: {
      shared,
      onlyTheirs: [...theirs.entries()]
        .filter(([key]) => !mine.has(key))
        .map(([, v]) => v)
        .sort((a, b) => b.from.length - a.from.length || a.tag.localeCompare(b.tag)),
      overlap: brand && usable.length && union.size ? shared.length / union.size : null,
    },
  };
}
