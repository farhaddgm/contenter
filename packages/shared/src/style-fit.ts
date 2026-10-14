/**
 * "Does this draft sit inside the statistical range of the brand's own examples?" — StyleFit
 * (docs/53-style-fit.md). Pure code, no model: counts of the draft are compared with a target
 * range computed from the topic's sample contents, or, for a business without samples, from the
 * averages of its Instagram account (docs/28). It says "inside / below / above the range", never
 * "reads like the brand": statistics cannot describe a voice, and few samples make a range
 * meaningless, so under `MIN_STYLE_SAMPLES` samples there is no verdict at all.
 */
import type { InstagramStats } from './social';
import { analyzeReadability } from './readability';
import { persianShare } from './quality';

/** Fewer analyzed samples than this and the range would be noise. */
export const MIN_STYLE_SAMPLES = 3;
/** A sample shorter than this many words says too little about style. */
export const MIN_SAMPLE_WORDS = 15;
/** An Instagram account needs this many posts read before its averages count. */
export const MIN_INSTAGRAM_POSTS = 6;
/** Instagram gives averages only, with no spread; the range is the average ± this share of it. */
export const INSTAGRAM_TOLERANCE = 0.5;

export const StyleMetric = [
  'chars',
  'avgSentenceWords',
  'paragraphs',
  'hashtags',
  'emojis',
  'persianShare',
  'question',
  'cta',
] as const;
export type StyleMetric = (typeof StyleMetric)[number];

const NUMERIC = [
  'chars',
  'avgSentenceWords',
  'paragraphs',
  'hashtags',
  'emojis',
  'persianShare',
] as const;
type NumericMetric = (typeof NUMERIC)[number];
const FLAGS = ['question', 'cta'] as const;
type FlagMetric = (typeof FLAGS)[number];

/** The counts of one text. */
export interface StyleStats {
  chars: number;
  avgSentenceWords: number;
  paragraphs: number;
  hashtags: number;
  emojis: number;
  /** 0–1 */
  persianShare: number;
  question: boolean;
  cta: boolean;
}

/** Phrases that ask the reader to act; a draft's own `cta` field counts too. */
const CTA_RE =
  /بخرید|بخر\b|سفارش|ثبت[‌ ]?نام|تماس بگیرید|دایرکت|پیام بدهید|کلیک|لینک (?:در )?بیو|رزرو|دانلود|اشتراک|همین حالا|هم‌اکنون|مشاوره رایگان/u;
const HASHTAG_RE = /#[\p{L}\p{N}_‌]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** `cta` is the draft's separate call-to-action field; leave it empty for a sample's raw text. */
export function styleStats(text: string, cta = ''): StyleStats {
  const clean = text.trim();
  const tags = new Set((clean.match(HASHTAG_RE) ?? []).map((t) => t.toLowerCase()));
  const read = analyzeReadability({ body: clean, platform: 'OTHER' });
  return {
    chars: [...clean].length,
    avgSentenceWords: read.metrics.avgSentenceWords,
    paragraphs: clean.split(/\n\s*\n/).filter((p) => p.trim()).length,
    hashtags: tags.size,
    emojis: (clean.match(EMOJI_RE) ?? []).length,
    persianShare: Math.round(persianShare(clean) * 100) / 100,
    question: /[?؟]/.test(clean),
    cta: !!cta.trim() || CTA_RE.test(clean),
  };
}

export interface NumericTarget {
  min: number;
  max: number;
  mean: number;
}

export type StyleSource = 'SAMPLES' | 'INSTAGRAM';

export interface StyleTargets {
  source: StyleSource;
  /** Samples read, or Instagram posts analyzed. */
  basedOn: number;
  numeric: Partial<Record<NumericMetric, NumericTarget>>;
  /** Share (0–1) of the examples with the flag; the flag is "expected" at ≥ 0.8, "not typical" at ≤ 0.2. */
  flags: Partial<Record<FlagMetric, number>>;
}

/** Smallest range half-width per metric, so identical examples do not make a zero-width range. */
const MIN_TOLERANCE: Record<NumericMetric, number> = {
  chars: 40,
  avgSentenceWords: 2,
  paragraphs: 1,
  hashtags: 1,
  emojis: 1,
  persianShare: 0.05,
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** The target range of the examples: mean ± max(1.5 σ, 25 % of the mean, a small floor per metric). */
export function targetsFromTexts(
  texts: readonly string[],
): StyleTargets | { tooFew: true; basedOn: number } {
  const stats = texts
    .filter(
      (t) => analyzeReadability({ body: t, platform: 'OTHER' }).metrics.words >= MIN_SAMPLE_WORDS,
    )
    .map((t) => styleStats(t));
  if (stats.length < MIN_STYLE_SAMPLES) return { tooFew: true, basedOn: stats.length };
  const numeric: StyleTargets['numeric'] = {};
  for (const m of NUMERIC) {
    const xs = stats.map((s) => s[m]);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    const tol = Math.max(sd * 1.5, mean * 0.25, MIN_TOLERANCE[m]);
    numeric[m] = {
      min: round(Math.max(0, mean - tol)),
      max: round(m === 'persianShare' ? Math.min(1, mean + tol) : mean + tol),
      mean: round(mean),
    };
  }
  const flags: StyleTargets['flags'] = {};
  for (const f of FLAGS) flags[f] = round(stats.filter((s) => s[f]).length / stats.length);
  return { source: 'SAMPLES', basedOn: stats.length, numeric, flags };
}

/** Targets from an Instagram account's averages: only the metrics the account's statistics carry. */
export function targetsFromInstagram(
  s: Pick<
    InstagramStats,
    | 'postsAnalyzed'
    | 'avgCaptionChars'
    | 'avgEmojisPerPost'
    | 'avgHashtagsPerPost'
    | 'scriptShare'
    | 'ctaShare'
    | 'questionShare'
  >,
): StyleTargets | { tooFew: true; basedOn: number } {
  if (s.postsAnalyzed < MIN_INSTAGRAM_POSTS) return { tooFew: true, basedOn: s.postsAnalyzed };
  const around = (mean: number, floor: number): NumericTarget => {
    const tol = Math.max(mean * INSTAGRAM_TOLERANCE, floor);
    return { min: round(Math.max(0, mean - tol)), max: round(mean + tol), mean: round(mean) };
  };
  const letters = s.scriptShare.persian + s.scriptShare.latin;
  return {
    source: 'INSTAGRAM',
    basedOn: s.postsAnalyzed,
    numeric: {
      chars: around(s.avgCaptionChars, MIN_TOLERANCE.chars),
      emojis: around(s.avgEmojisPerPost, MIN_TOLERANCE.emojis),
      hashtags: around(s.avgHashtagsPerPost, MIN_TOLERANCE.hashtags),
      ...(letters > 0
        ? {
            persianShare: (() => {
              const t = around(s.scriptShare.persian / letters, MIN_TOLERANCE.persianShare);
              return { ...t, max: Math.min(1, t.max) };
            })(),
          }
        : {}),
    },
    flags: { cta: round(s.ctaShare), question: round(s.questionShare) },
  };
}

export type StyleStatus = 'inside' | 'below' | 'above';

export interface StyleFitRow {
  metric: StyleMetric;
  /** The draft's number (a flag is 0 or 1). */
  value: number;
  status: StyleStatus;
  /** Numeric metrics: the range the examples span. */
  range?: { min: number; max: number };
  /** Flags: what the examples mostly do. */
  expected?: boolean;
}

export interface StyleFitReport {
  source: StyleSource;
  basedOn: number;
  rows: StyleFitRow[];
  inside: number;
  total: number;
}

/**
 * Where each count of the draft lies against the targets. A flag the examples do not settle
 * (between 20 % and 80 %) is always inside, because either choice fits them.
 */
export function assessStyleFit(draft: StyleStats, targets: StyleTargets): StyleFitReport {
  const rows: StyleFitRow[] = [];
  for (const m of NUMERIC) {
    const t = targets.numeric[m];
    if (!t) continue;
    const value = draft[m];
    rows.push({
      metric: m,
      value,
      status: value < t.min ? 'below' : value > t.max ? 'above' : 'inside',
      range: { min: t.min, max: t.max },
    });
  }
  for (const f of FLAGS) {
    const share = targets.flags[f];
    if (share === undefined) continue;
    const expected = share >= 0.8 ? true : share <= 0.2 ? false : undefined;
    const has = draft[f];
    rows.push({
      metric: f,
      value: has ? 1 : 0,
      // "above" = the draft has what the examples do not; "below" = it lacks what they all have
      status: expected === undefined || expected === has ? 'inside' : has ? 'above' : 'below',
      ...(expected === undefined ? {} : { expected }),
    });
  }
  return {
    source: targets.source,
    basedOn: targets.basedOn,
    rows,
    inside: rows.filter((r) => r.status === 'inside').length,
    total: rows.length,
  };
}
