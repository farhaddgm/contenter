/**
 * Approximate Persian readability (docs/47-readability.md). Pure code: the model never judges
 * whether a text is "heavy". There is no accepted Persian readability formula, so these are
 * plain, explainable counts (sentence length, long sentences, word length, Latin share and a
 * short list of stiff, translated-sounding phrases) with a limit per platform. It only informs;
 * it never blocks a review step, a schedule or a publish.
 */
import { z } from 'zod';
import type { Platform } from './enums';
import { countPhrase, normalizeTermText } from './business-profile';

/** A sentence longer than this many words counts as "long". */
export const LONG_SENTENCE_WORDS = 30;
/** Under this many words the numbers are noise, so no verdict is given. */
export const MIN_READABILITY_WORDS = 20;
/** More than this share of long sentences is flagged. */
export const MAX_LONG_SENTENCE_SHARE = 0.25;
/** A longer mean word length (letters) is flagged. */
export const MAX_AVG_WORD_LETTERS = 6;
/** More than this share of Latin words in a Persian text is flagged. */
export const MAX_LATIN_SHARE = 0.2;
/** This many stiff phrases (counting repeats) are flagged. */
export const MIN_STIFF_HITS = 2;

/** Mean sentence length (words) above which a platform's text is flagged. */
export const READABILITY_AVG_SENTENCE_WORDS: Record<Platform, number> = {
  X: 14,
  INSTAGRAM: 18,
  TELEGRAM: 20,
  TIKTOK: 16,
  YOUTUBE: 20,
  EITAA: 20,
  BALE: 20,
  RUBIKA: 20,
  APARAT: 20,
  LINKEDIN: 24,
  NEWSLETTER: 24,
  BLOG: 26,
  OTHER: 22,
};

/**
 * Phrases that make Persian sound stiff or translated from English/bureaucratic. A starting list
 * (data, not a prompt); the admin adds their own in the settings.
 */
export const DEFAULT_STIFF_PHRASES = [
  'در جهت',
  'به منظور آنکه',
  'به منظور',
  'در رابطه با',
  'در خصوص',
  'مورد استفاده قرار',
  'مورد بررسی قرار',
  'صورت می‌گیرد',
  'صورت گرفت',
  'می‌باشد',
  'گردید',
  'توسط',
  'قادر است',
  'قادر به',
] as const;

export const READABILITY_MAX_EXTRA_PHRASES = 50;
export const READABILITY_PHRASE_MAX_CHARS = 60;

/** What the admin may change without a deploy. */
export const ReadabilitySettingsSchema = z.object({
  /** Added to `DEFAULT_STIFF_PHRASES`. */
  extraPhrases: z
    .array(z.string().trim().min(2).max(READABILITY_PHRASE_MAX_CHARS))
    .max(READABILITY_MAX_EXTRA_PHRASES)
    .default([]),
  /** Replaces the per-platform limit of the mean sentence length (words); null keeps the table. */
  maxAvgSentenceWords: z.number().int().min(5).max(80).nullable().default(null),
});
export type ReadabilitySettings = z.infer<typeof ReadabilitySettingsSchema>;
export const DEFAULT_READABILITY_SETTINGS: ReadabilitySettings = {
  extraPhrases: [],
  maxAvgSentenceWords: null,
};

export const ReadabilityNoteCode = [
  'SENTENCES_LONG_AVG',
  'SENTENCES_LONG_SHARE',
  'WORDS_HEAVY',
  'LATIN_HEAVY',
  'STIFF_PHRASES',
] as const;
export type ReadabilityNoteCode = (typeof ReadabilityNoteCode)[number];

export interface ReadabilityNote {
  code: ReadabilityNoteCode;
  params: Record<string, string | number>;
}

export interface ReadabilityMetrics {
  words: number;
  sentences: number;
  /** Mean words per sentence. */
  avgSentenceWords: number;
  /** Share (0–1) of sentences longer than `LONG_SENTENCE_WORDS`. */
  longSentenceShare: number;
  /** Mean letters per word (half-spaces and digits not counted). */
  avgWordLetters: number;
  /** Share (0–1) of words written in Latin letters. */
  latinShare: number;
  /** The stiff phrases found, each with its count (most frequent first). */
  stiffPhrases: { phrase: string; count: number }[];
}

export interface ReadabilityReport {
  /** False under `MIN_READABILITY_WORDS` words: the numbers are given but no note is raised. */
  enough: boolean;
  metrics: ReadabilityMetrics;
  /** The limits used, so the UI can draw each bar against its mark. */
  limits: {
    avgSentenceWords: number;
    longSentenceShare: number;
    avgWordLetters: number;
    latinShare: number;
  };
  notes: ReadabilityNote[];
}

export interface ReadabilityInput {
  body: string;
  cta?: string;
  platform: Platform;
  settings?: Partial<ReadabilitySettings>;
}

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Hashtags, mentions and links are not sentences. */
function stripNonProse(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/(^|\s)[#@][^\s]+/gu, ' ')
    .replace(/[`*_>~|]+/g, ' ');
}

const WORD_RE = /[\p{L}][\p{L}\p{M}‌]*/gu;
const LATIN_RE = /[A-Za-z]/;

/** Sentences: split on . ! ? ؟ … and on line breaks (a list item or a heading is one sentence). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟…])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}]/u.test(s));
}

/** Pure: same input, same report. Empty or symbol-only input gives zeros, never an error. */
export function analyzeReadability(input: ReadabilityInput): ReadabilityReport {
  const settings = { ...DEFAULT_READABILITY_SETTINGS, ...input.settings };
  const prose = stripNonProse([input.body, input.cta ?? ''].join('\n'));
  const sentences = splitSentences(prose);
  const perSentence = sentences.map((s) => s.match(WORD_RE) ?? []);
  const allWords = perSentence.flat();
  const words = allWords.length;

  const lengths = perSentence.map((w) => w.length);
  const longCount = lengths.filter((n) => n > LONG_SENTENCE_WORDS).length;
  const letters = allWords.reduce((sum, w) => sum + w.replace(/[^\p{L}]/gu, '').length, 0);
  const latinWords = allWords.filter((w) => LATIN_RE.test(w)).length;

  // stiff phrases are matched on the normalized text (half-space = space), longest phrase first so
  // "به منظور آنکه" is not also counted as "به منظور"
  const hay = normalizeTermText(prose);
  const phrases = [...new Set([...DEFAULT_STIFF_PHRASES, ...settings.extraPhrases])]
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const stiff: { phrase: string; count: number }[] = [];
  let rest = hay;
  for (const phrase of phrases) {
    const count = countPhrase(rest, phrase);
    if (!count) continue;
    stiff.push({ phrase, count });
    const n = normalizeTermText(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'gu'), ' ');
  }
  stiff.sort((a, b) => b.count - a.count);

  const metrics: ReadabilityMetrics = {
    words,
    sentences: sentences.length,
    avgSentenceWords: sentences.length ? round(words / sentences.length, 1) : 0,
    longSentenceShare: sentences.length ? round(longCount / sentences.length) : 0,
    avgWordLetters: words ? round(letters / words, 1) : 0,
    latinShare: words ? round(latinWords / words) : 0,
    stiffPhrases: stiff,
  };
  const limits = {
    avgSentenceWords: settings.maxAvgSentenceWords ?? READABILITY_AVG_SENTENCE_WORDS[input.platform],
    longSentenceShare: MAX_LONG_SENTENCE_SHARE,
    avgWordLetters: MAX_AVG_WORD_LETTERS,
    latinShare: MAX_LATIN_SHARE,
  };

  const enough = words >= MIN_READABILITY_WORDS;
  const notes: ReadabilityNote[] = [];
  if (enough) {
    if (metrics.avgSentenceWords > limits.avgSentenceWords) {
      notes.push({
        code: 'SENTENCES_LONG_AVG',
        params: { avg: metrics.avgSentenceWords, max: limits.avgSentenceWords },
      });
    }
    if (metrics.longSentenceShare > limits.longSentenceShare) {
      notes.push({
        code: 'SENTENCES_LONG_SHARE',
        params: { count: longCount, total: sentences.length, words: LONG_SENTENCE_WORDS },
      });
    }
    if (metrics.avgWordLetters > limits.avgWordLetters) {
      notes.push({
        code: 'WORDS_HEAVY',
        params: { avg: metrics.avgWordLetters, max: limits.avgWordLetters },
      });
    }
    if (metrics.latinShare > limits.latinShare) {
      notes.push({
        code: 'LATIN_HEAVY',
        params: { share: Math.round(metrics.latinShare * 100) },
      });
    }
    const hits = stiff.reduce((n, s) => n + s.count, 0);
    if (hits >= MIN_STIFF_HITS) {
      notes.push({
        code: 'STIFF_PHRASES',
        params: { count: hits, phrases: stiff.slice(0, 5).map((s) => `«${s.phrase}»`).join('، ') },
      });
    }
  }
  return { enough, metrics, limits, notes };
}
