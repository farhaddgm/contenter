/**
 * Literal similarity between texts (docs/48-similarity.md). Pure code: the model never decides
 * whether a draft "looks like" something else. Texts are folded to one spelling (`fold`: Arabic and
 * Persian yeh/kaf, three digit scripts, half-space), cut into word shingles and compared by Jaccard
 * and by containment (how much of the new text is found in the other one).
 *
 * This catches repeated and copied wording. It does not catch a rewrite with the same meaning;
 * that needs embeddings (docs/27 idea 18) and is said so in the UI. It only warns.
 */
import { z } from 'zod';
import { fold } from './search';

/** Words per shingle. */
export const SHINGLE_SIZE = 4;
/** Under this many words a text is too short to compare. */
export const MIN_SIMILARITY_WORDS = 10;
/** The most matches a report lists. */
export const MAX_SIMILARITY_MATCHES = 3;

export const SimilaritySource = ['CONTENT', 'IDEA', 'SAMPLE', 'REFERENCE'] as const;
export type SimilaritySource = (typeof SimilaritySource)[number];

/** What the admin may change without a deploy. */
export const SimilaritySettingsSchema = z
  .object({
    /** From this score on a draft is "similar" (warning). */
    warnAt: z.number().min(0.2).max(0.95).default(0.55),
    /** From this score on it is "almost a copy". */
    copyAt: z.number().min(0.3).max(1).default(0.8),
  })
  .refine((v) => v.copyAt > v.warnAt, {
    message: 'copyAt must be higher than warnAt',
    path: ['copyAt'],
  });
export type SimilaritySettings = z.infer<typeof SimilaritySettingsSchema>;
export const DEFAULT_SIMILARITY_SETTINGS: SimilaritySettings = { warnAt: 0.55, copyAt: 0.8 };

/** Words of a text in one canonical spelling; punctuation, marks and symbols are dropped. */
export function similarityWords(text: string): string[] {
  return fold(text)
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/** The set of word shingles of a text; a text shorter than one shingle is a single shingle. */
export function shingleSet(words: readonly string[], size = SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  if (!words.length) return out;
  if (words.length < size) {
    out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

export interface TextFingerprint {
  words: number;
  shingles: Set<string>;
}

export function fingerprint(text: string): TextFingerprint {
  const words = similarityWords(text);
  return { words: words.length, shingles: shingleSet(words) };
}

/**
 * 0–1. The larger of the Jaccard index and the share of `a` that also occurs in `b`: a short post
 * copied out of a long article has a low Jaccard but is fully contained.
 */
export function similarityScore(a: TextFingerprint, b: TextFingerprint): number {
  if (!a.shingles.size || !b.shingles.size) return 0;
  const [small, large] =
    a.shingles.size <= b.shingles.size ? [a.shingles, b.shingles] : [b.shingles, a.shingles];
  let common = 0;
  for (const s of small) if (large.has(s)) common++;
  if (!common) return 0;
  const jaccard = common / (a.shingles.size + b.shingles.size - common);
  const contained = common / a.shingles.size;
  return Math.max(jaccard, contained);
}

export interface SimilarityCandidate {
  kind: SimilaritySource;
  id: string;
  title: string;
  text: string;
  /** Where the candidate lives, for the link. */
  topicId?: string | null;
  businessId?: string | null;
}

export interface SimilarityMatch {
  kind: SimilaritySource;
  id: string;
  title: string;
  /** 0–1, rounded to two decimals. */
  score: number;
  topicId: string | null;
  businessId: string | null;
}

export type SimilarityLevel = 'NONE' | 'SIMILAR' | 'COPY';

export interface SimilarityReport {
  level: SimilarityLevel;
  /** Matches at or above the warning score, best first (at most `MAX_SIMILARITY_MATCHES`). */
  matches: SimilarityMatch[];
  /** How many candidates were compared. */
  compared: number;
  /** False when the text is shorter than `MIN_SIMILARITY_WORDS`: no verdict. */
  enough: boolean;
  thresholds: SimilaritySettings;
}

/**
 * Compares `text` with every candidate. Pure: same input, same report. Empty text or an empty
 * candidate list is not an error.
 */
export function contentSimilarity(
  text: string,
  candidates: readonly SimilarityCandidate[],
  thresholds: SimilaritySettings = DEFAULT_SIMILARITY_SETTINGS,
): SimilarityReport {
  const subject = fingerprint(text);
  const enough = subject.words >= MIN_SIMILARITY_WORDS;
  const base = { compared: candidates.length, enough, thresholds };
  if (!enough) return { level: 'NONE', matches: [], ...base };

  const scored: SimilarityMatch[] = [];
  for (const c of candidates) {
    const other = fingerprint(c.text);
    // a very short candidate (a title-only idea) cannot show a copy
    if (other.words < MIN_SIMILARITY_WORDS) continue;
    const score = similarityScore(subject, other);
    if (score >= thresholds.warnAt) {
      scored.push({
        kind: c.kind,
        id: c.id,
        title: c.title,
        score: Math.round(score * 100) / 100,
        topicId: c.topicId ?? null,
        businessId: c.businessId ?? null,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const matches = scored.slice(0, MAX_SIMILARITY_MATCHES);
  const best = matches[0]?.score ?? 0;
  return {
    level: best >= thresholds.copyAt ? 'COPY' : best >= thresholds.warnAt ? 'SIMILAR' : 'NONE',
    matches,
    ...base,
  };
}
