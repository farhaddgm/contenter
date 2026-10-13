/**
 * Pre-publish quality gate (docs/41-quality-gate.md). Everything here is deterministic code: the
 * model never decides whether a text is acceptable. The gate only warns; it never blocks a
 * review step or a publish.
 *
 * Checks:
 * - platform limits (`PLATFORM_RULES`): length, hashtag count, per-post length of a thread
 * - brand terminology (`checkTerms`)
 * - numbers against key facts (`BusinessFact`): a sentence that talks about a fact but quotes
 *   none of its numbers, and facts whose validity date has passed
 * - Persian typography: mixed digit scripts, Arabic yeh/kaf, missing half-space, Latin
 *   punctuation, space before punctuation, double spaces
 * - leftover placeholders ("[نام مشتری]", TODO, lorem ipsum)
 */
import type { ContentFormat, Platform } from './enums';
import {
  checkTerms,
  countPhrase,
  isFactExpired,
  normalizeTermText,
  type TermIssue,
  type TermRule,
} from './business-profile';

// ─────────────────────────────── platform rules ───────────────────────────────

export interface PlatformRules {
  /** Longest text of one post (body, hashtags and call to action together). */
  maxChars?: number;
  /** Longest caption when media is attached; only shown as information. */
  captionMaxChars?: number;
  /** Most hashtags the platform accepts. */
  maxHashtags?: number;
  /** Longest title (video platforms). */
  titleMaxChars?: number;
  /** `official` = read in the platform's own documentation; `known` = common knowledge, may change. */
  confidence: 'official' | 'known' | 'unknown';
  /** Where the number comes from, for the admin. */
  note?: string;
}

/**
 * Limits by platform. Only numbers I could source are filled; a missing number means "no check",
 * never "no limit". Eitaa, Rubika and Aparat publish no text limits in the documentation I found
 * (docs/40), so they are left empty.
 */
export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  INSTAGRAM: {
    maxChars: 2200,
    maxHashtags: 30,
    confidence: 'known',
    note: 'caption: 2200 characters, 30 hashtags',
  },
  YOUTUBE: {
    maxChars: 5000,
    titleMaxChars: 100,
    confidence: 'known',
    note: 'description: 5000 characters; title: 100',
  },
  TELEGRAM: {
    maxChars: 4096,
    captionMaxChars: 1024,
    confidence: 'known',
    note: 'message: 4096 characters; caption of a media post: 1024',
  },
  LINKEDIN: { maxChars: 3000, confidence: 'known', note: 'post: 3000 characters' },
  X: { maxChars: 280, confidence: 'known', note: 'post: 280 characters (a thread is checked per post)' },
  TIKTOK: { maxChars: 2200, confidence: 'known', note: 'caption: 2200 characters' },
  BLOG: { confidence: 'unknown' },
  OTHER: { confidence: 'unknown' },
  EITAA: { confidence: 'unknown', note: 'no text limit in the EitaaYar documentation' },
  BALE: {
    maxChars: 4096,
    captionMaxChars: 4096,
    confidence: 'official',
    note: 'docs.bale.ai: text 1–4096, caption 0–4096',
  },
  RUBIKA: { confidence: 'unknown', note: 'no text limit in the Rubika Bot API documentation' },
  APARAT: { confidence: 'unknown' },
  NEWSLETTER: { confidence: 'unknown' },
};

// ─────────────────────────────── digits and numbers ───────────────────────────────

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian and Arabic-Indic digits → Latin digits; separators → `,` and `.`. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) {
      out += String(p);
      continue;
    }
    const a = ARABIC_DIGITS.indexOf(ch);
    out += a >= 0 ? String(a) : ch;
  }
  return out.replace(/٬/g, ',').replace(/٫/g, '.');
}

const SCALE_WORDS: Record<string, number> = {
  هزار: 1e3,
  میلیون: 1e6,
  میلیارد: 1e9,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

const canon = (n: string): string => {
  const [i, f] = n.split('.');
  const int = i.replace(/^0+(?=\d)/, '');
  return f && /[1-9]/.test(f) ? `${int}.${f.replace(/0+$/, '')}` : int;
};

/**
 * Numbers in a text as canonical strings ("۵۰۰,۰۰۰" → "500000"). A number followed by a scale
 * word also yields its scaled value ("۵۰۰ هزار" → "500" and "500000"), so a price written either
 * way matches.
 */
export function extractNumbers(text: string): string[] {
  const t = normalizeDigits(text).replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  const out = new Set<string>();
  const re = /\d+(?:\.\d+)?(?:\s+([^\s\d.,،؛:!؟?()«»"']+))?/gu;
  for (const m of t.matchAll(re)) {
    const num = m[0].match(/^\d+(?:\.\d+)?/)![0];
    out.add(canon(num));
    const scale = m[1] ? SCALE_WORDS[normalizeTermText(m[1])] : undefined;
    if (scale) {
      const v = Number(num) * scale;
      if (Number.isFinite(v) && v < Number.MAX_SAFE_INTEGER) out.add(String(v));
    }
  }
  return [...out];
}

// ─────────────────────────────── Persian typography ───────────────────────────────

export const TypographyKind = [
  'HALF_SPACE',
  'ARABIC_LETTER',
  'LATIN_PUNCTUATION',
  'SPACE_BEFORE_PUNCTUATION',
  'DOUBLE_SPACE',
] as const;
export type TypographyKind = (typeof TypographyKind)[number];

export interface TypographyIssue {
  kind: TypographyKind;
  /** The text found. */
  found: string;
  /** What it should be (the half-space or letter fix); '' when it is only a removal. */
  replacement: string;
  /** Index into the text that was checked. */
  index: number;
}

const ZWNJ = '‌';
const FA_LETTER = '[\\u0600-\\u06FF]';

/** Prefix and suffix particles that are written with a half-space in Persian. */
const HALF_SPACE_PATTERNS: RegExp[] = [
  // می / نمی before a verb stem: "می کنم" → "می‌کنم"
  new RegExp(`(?<![\\u0600-\\u06FF])(ن?می) (?=${FA_LETTER}{2,})`, 'gu'),
  // plural, comparative and superlative suffixes: "کتاب ها" → "کتاب‌ها"
  new RegExp(`(?<=${FA_LETTER}) (?=(?:ها|های|هایی|ترین|تر)(?![\\u0600-\\u06FF]))`, 'gu'),
];

/** Ranges of text typography checks must skip: code, URLs, @mentions and #hashtags. */
function skipRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|[@#][\w؀-ۿ_‌]+/gu;
  for (const m of text.matchAll(re)) ranges.push([m.index!, m.index! + m[0].length]);
  return ranges;
}

const inRanges = (i: number, ranges: [number, number][]) =>
  ranges.some(([a, b]) => i >= a && i < b);

/** Share of Persian letters among all letters; Persian typography rules apply above 0.5. */
export function persianShare(text: string): number {
  let fa = 0;
  let all = 0;
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      all += 1;
      if (/[؀-ۿ]/.test(ch)) fa += 1;
    }
  }
  return all ? fa / all : 0;
}

/** Typography findings of a Persian text, each with the fix. Empty for non-Persian text. */
export function persianTypographyIssues(text: string): TypographyIssue[] {
  if (persianShare(text) < 0.5) return [];
  const skip = skipRanges(text);
  const out: TypographyIssue[] = [];
  const push = (i: TypographyIssue) => {
    if (!inRanges(i.index, skip)) out.push(i);
  };

  for (const re of HALF_SPACE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      const isPrefix = m[1] !== undefined;
      const idx = isPrefix ? start + m[1].length : start;
      push({
        kind: 'HALF_SPACE',
        found: text.slice(Math.max(0, idx - 4), idx + 5).replace(/\s+/g, ' '),
        replacement: ZWNJ,
        index: idx,
      });
    }
  }
  for (const m of text.matchAll(/[يك]/g)) {
    push({
      kind: 'ARABIC_LETTER',
      found: m[0],
      replacement: m[0] === 'ي' ? 'ی' : 'ک',
      index: m.index!,
    });
  }
  // Latin comma, semicolon and question mark right after a Persian letter
  for (const m of text.matchAll(new RegExp(`(?<=${FA_LETTER})[,;?]`, 'gu'))) {
    push({
      kind: 'LATIN_PUNCTUATION',
      found: m[0],
      replacement: m[0] === ',' ? '،' : m[0] === ';' ? '؛' : '؟',
      index: m.index!,
    });
  }
  for (const m of text.matchAll(/(?<=\S)[ \t]+(?=[،؛؟!:.])/gu)) {
    push({ kind: 'SPACE_BEFORE_PUNCTUATION', found: m[0], replacement: '', index: m.index! });
  }
  // two or more spaces inside a line (indentation of Markdown lists is not touched)
  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/gu)) {
    push({ kind: 'DOUBLE_SPACE', found: m[0], replacement: ' ', index: m.index! });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** True when the prose mixes Persian-Indic and Latin digits (words like "4K" are not counted). */
export function hasMixedDigits(text: string): boolean {
  const skip = skipRanges(text);
  let persian = false;
  let latin = false;
  for (const m of text.matchAll(/[0-9۰-۹٠-٩]+/g)) {
    const i = m.index!;
    if (inRanges(i, skip)) continue;
    const before = text[i - 1] ?? '';
    const after = text[i + m[0].length] ?? '';
    // a digit glued to Latin letters is a name or code (4K, COVID19, mp3), not prose
    if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) continue;
    if (/[۰-۹٠-٩]/.test(m[0])) persian = true;
    else latin = true;
  }
  return persian && latin;
}

// ─────────────────────────────── the gate ───────────────────────────────

export const QualityIssueCode = [
  'LENGTH_OVER',
  'THREAD_POST_OVER',
  'HASHTAGS_OVER',
  'TERM_AVOID',
  'TERM_USE',
  'FACT_NUMBER_MISMATCH',
  'FACT_EXPIRED',
  'DIGITS_MIXED',
  'ARABIC_LETTER',
  'HALF_SPACE',
  'LATIN_PUNCTUATION',
  'SPACE_BEFORE_PUNCTUATION',
  'DOUBLE_SPACE',
  'PLACEHOLDER',
  'EMPTY_BODY',
] as const;
export type QualityIssueCode = (typeof QualityIssueCode)[number];

/** warn = should be fixed before publishing · info = style detail. */
export type QualitySeverity = 'warn' | 'info';

export interface QualityIssue {
  code: QualityIssueCode;
  severity: QualitySeverity;
  /** Short, stable facts the UI turns into a message (counts, limits, the offending text). */
  params: Record<string, string | number>;
}

export interface QualityFactRule {
  label: string;
  value: string;
  validUntil?: string | Date | null;
  isActive?: boolean;
}

export interface QualityInput {
  title: string;
  body: string;
  hashtags: readonly string[];
  cta: string;
  platform: Platform;
  format: ContentFormat;
  facts?: readonly QualityFactRule[];
  terms?: readonly TermRule[];
  now?: Date;
}

export interface QualityReport {
  issues: QualityIssue[];
  warnings: number;
  /** Rules applied, so the UI can say which limit was used. */
  rules: PlatformRules;
  /** Characters counted against the platform limit. */
  length: number;
}

const stripHash = (h: string) => h.trim().replace(/^#+/, '');

/** Text as it is published: body, hashtags and call to action. */
export function publishText(
  i: Pick<QualityInput, 'body' | 'hashtags' | 'cta'>,
): string {
  const tags = i.hashtags.map(stripHash).filter(Boolean).map((h) => `#${h}`).join(' ');
  return [i.body.trim(), i.cta.trim(), tags].filter(Boolean).join('\n\n');
}

const charCount = (s: string) => [...s].length;

const STOP_WORDS = new Set(['از', 'در', 'به', 'با', 'و', 'را', 'که', 'این', 'آن', 'برای', 'تا', 'of', 'the']);

const tokens = (s: string): string[] =>
  normalizeTermText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

/** A sentence talks about a fact when it contains (nearly) all the words of the fact's label. */
function mentionsLabel(sentence: string, label: string): boolean {
  const lt = tokens(label);
  if (!lt.length) return false;
  if (countPhrase(normalizeTermText(sentence), label) > 0) return true;
  const st = new Set(tokens(sentence));
  const hit = lt.filter((w) => st.has(w)).length;
  return lt.length === 1 ? hit === 1 : hit / lt.length >= 0.75 && hit >= 2;
}

const PLACEHOLDER_RE =
  /lorem ipsum|\bTODO\b|\bFIXME\b|\bXXX+\b|\[[^\]\n]{0,40}(?:نام|لینک|قیمت|تاریخ|شماره|name|link|price|date|insert|todo)[^\]\n]{0,40}\]|\{\{[^}\n]*\}\}/iu;

/** Posts of a thread: the blocks separated by a blank line or a `---` line. */
export function threadPosts(body: string): string[] {
  return body
    .split(/\n\s*\n|\n-{3,}\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Runs every check on one piece of content. Pure: same input, same report. */
export function checkContentQuality(input: QualityInput): QualityReport {
  const rules = PLATFORM_RULES[input.platform];
  const issues: QualityIssue[] = [];
  const now = input.now ?? new Date();
  const text = publishText(input);
  const length = charCount(text);

  if (!input.body.trim()) {
    issues.push({ code: 'EMPTY_BODY', severity: 'warn', params: {} });
  }

  // platform limits
  if (rules.maxChars && input.format !== 'THREAD' && length > rules.maxChars) {
    issues.push({
      code: 'LENGTH_OVER',
      severity: 'warn',
      params: { length, max: rules.maxChars, over: length - rules.maxChars },
    });
  }
  if (input.format === 'THREAD' && rules.maxChars) {
    threadPosts(input.body).forEach((post, idx) => {
      const n = charCount(post);
      if (n > rules.maxChars!) {
        issues.push({
          code: 'THREAD_POST_OVER',
          severity: 'warn',
          params: { post: idx + 1, length: n, max: rules.maxChars!, over: n - rules.maxChars! },
        });
      }
    });
  }
  const tagCount = new Set(input.hashtags.map(stripHash).filter(Boolean)).size;
  if (rules.maxHashtags && tagCount > rules.maxHashtags) {
    issues.push({
      code: 'HASHTAGS_OVER',
      severity: 'warn',
      params: { count: tagCount, max: rules.maxHashtags },
    });
  }

  // brand terminology
  const checked = [input.title, input.body, input.hashtags.join(' '), input.cta].join('\n');
  const termIssues: TermIssue[] = input.terms?.length ? checkTerms(checked, input.terms) : [];
  for (const t of termIssues) {
    issues.push({
      code: t.kind === 'AVOID' ? 'TERM_AVOID' : 'TERM_USE',
      severity: 'warn',
      params: { found: t.found, term: t.term, count: t.count, replaceWith: t.replaceWith.join('، ') },
    });
  }

  // numbers and validity of key facts
  const sentences = [input.title, ...input.body.split(/(?<=[.!?؟…])\s+|\n+/), input.cta]
    .map((s) => s.trim())
    .filter(Boolean);
  for (const fact of input.facts ?? []) {
    if (fact.isActive === false) continue;
    const factNumbers = new Set(extractNumbers(fact.value));
    const expired = isFactExpired(fact.validUntil ?? null, now);
    const normalizedValue = normalizeTermText(fact.value);
    let expiredReported = false;
    for (const sentence of sentences) {
      const talks = mentionsLabel(sentence, fact.label);
      if (expired && !expiredReported && (talks || (normalizedValue.length >= 4 && countPhrase(normalizeTermText(sentence), fact.value) > 0))) {
        issues.push({
          code: 'FACT_EXPIRED',
          severity: 'warn',
          params: {
            label: fact.label,
            value: fact.value,
            validUntil: new Date(fact.validUntil!).toISOString().slice(0, 10),
          },
        });
        expiredReported = true;
      }
      if (!talks || !factNumbers.size) continue;
      const found = extractNumbers(sentence);
      if (found.length && !found.some((n) => factNumbers.has(n))) {
        issues.push({
          code: 'FACT_NUMBER_MISMATCH',
          severity: 'warn',
          params: {
            label: fact.label,
            expected: fact.value,
            found: found.join('، '),
            sentence: sentence.length > 140 ? `${sentence.slice(0, 137)}…` : sentence,
          },
        });
      }
    }
  }

  // placeholders
  const placeholder = checked.match(PLACEHOLDER_RE);
  if (placeholder) {
    issues.push({ code: 'PLACEHOLDER', severity: 'warn', params: { found: placeholder[0] } });
  }

  // Persian typography
  const typo = persianTypographyIssues(checked);
  const byKind = new Map<TypographyKind, TypographyIssue[]>();
  for (const t of typo) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
  const typoCode: Record<TypographyKind, QualityIssueCode> = {
    HALF_SPACE: 'HALF_SPACE',
    ARABIC_LETTER: 'ARABIC_LETTER',
    LATIN_PUNCTUATION: 'LATIN_PUNCTUATION',
    SPACE_BEFORE_PUNCTUATION: 'SPACE_BEFORE_PUNCTUATION',
    DOUBLE_SPACE: 'DOUBLE_SPACE',
  };
  for (const [kind, list] of byKind) {
    issues.push({
      code: typoCode[kind],
      severity: 'info',
      params: { count: list.length, example: list[0].found },
    });
  }
  if (persianShare(checked) >= 0.5 && hasMixedDigits(checked)) {
    issues.push({ code: 'DIGITS_MIXED', severity: 'info', params: {} });
  }

  return {
    issues,
    warnings: issues.filter((i) => i.severity === 'warn').length,
    rules,
    length,
  };
}
