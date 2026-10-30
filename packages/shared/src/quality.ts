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
import { registerMarkers } from './register';
import type { LanguageRegister } from './register-enum';

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
  X: {
    maxChars: 280,
    confidence: 'known',
    note: 'post: 280 characters (a thread is checked per post)',
  },
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

// ─────────────────────────────── prices ───────────────────────────────

export const PriceCurrency = ['IRT', 'IRR', 'USD', 'EUR'] as const;
export type PriceCurrency = (typeof PriceCurrency)[number];

/** Currency words (already normalized by `normalizeTermText`) → currency. */
const CURRENCY_OF: Record<string, PriceCurrency> = {
  تومان: 'IRT',
  تومن: 'IRT',
  toman: 'IRT',
  irt: 'IRT',
  ریال: 'IRR',
  rial: 'IRR',
  irr: 'IRR',
  دلار: 'USD',
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  یورو: 'EUR',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
};
const CURRENCY_WORD = Object.keys(CURRENCY_OF)
  .sort((a, b) => b.length - a.length)
  .join('|');
const SCALE_WORD = Object.keys(SCALE_WORDS).join('|');
/** "199 هزار تومان", "199000 ریال", "20 dollars", "۱۹۹ هزار تومانی" */
const PRICE_AFTER = new RegExp(
  `(\\d+(?:\\.\\d+)?)(?:\\s*(${SCALE_WORD}))?\\s*(${CURRENCY_WORD})ی?(?![\\p{L}])`,
  'gu',
);
/** "$20", "€ 1.5 million" */
const PRICE_SYMBOL = new RegExp(`([$€])\\s*(\\d+(?:\\.\\d+)?)(?:\\s*(${SCALE_WORD}))?`, 'gu');

export interface PriceMention {
  /** In the currency's own unit ("۱۹۹ هزار تومان" → 199000). */
  value: number;
  currency: PriceCurrency;
}

/**
 * Amounts a text states as prices: a number (with an optional scale word like "هزار") right
 * before a currency word, or after a currency symbol. A number without a currency is not a price
 * (a warranty of "۳ ماه" or a count is not), which keeps the offering check quiet.
 */
export function extractPrices(text: string): PriceMention[] {
  const t = normalizeTermText(normalizeDigits(text)).replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  const out: PriceMention[] = [];
  const push = (num: string, scale: string | undefined, currency: PriceCurrency) => {
    const factor = scale ? (SCALE_WORDS[normalizeTermText(scale)] ?? 1) : 1;
    const value = Number(num) * factor;
    if (Number.isFinite(value) && value < Number.MAX_SAFE_INTEGER) out.push({ value, currency });
  };
  for (const m of t.matchAll(PRICE_AFTER)) {
    const currency = CURRENCY_OF[m[3]!];
    if (currency) push(m[1]!, m[2], currency);
  }
  for (const m of t.matchAll(PRICE_SYMBOL)) {
    push(m[2]!, m[3], m[1] === '$' ? 'USD' : 'EUR');
  }
  return out;
}

export type PriceComparison = 'match' | 'mismatch' | 'incomparable';

/**
 * A stated price against an offering's price. Toman and rial are compared through ×10 (both are
 * written in Iranian texts); other currencies are only compared with themselves. With `from`
 * (the price is "from …") any amount at or above it matches.
 */
export function comparePrice(
  offer: { amount: number; currency: string; from?: boolean },
  found: PriceMention,
): PriceComparison {
  let value = found.value;
  if (found.currency !== offer.currency) {
    if (offer.currency === 'IRT' && found.currency === 'IRR') value = found.value / 10;
    else if (offer.currency === 'IRR' && found.currency === 'IRT') value = found.value * 10;
    else return 'incomparable';
  }
  const ok = offer.from ? value >= offer.amount - 0.005 : Math.abs(value - offer.amount) < 0.005;
  return ok ? 'match' : 'mismatch';
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
  'REGISTER_COLLOQUIAL',
  'REGISTER_STIFF',
  'PLACEHOLDER',
  'EMPTY_BODY',
  'OFFERING_PRICE_MISMATCH',
  'OFFERING_UNAVAILABLE',
  'GUARDRAIL_HIT',
  'OFFERING_CROSSED',
  'ALTERNATIVE_NAMED',
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

/** What the check needs to know about an offering of the business catalog (docs/67). */
export interface QualityOfferingRule {
  /** Needed to tell the focused offering from the others (`QualityInput.focus`). */
  id?: string;
  name: string;
  /** Features of the offering, to notice another offering's features in a text about this one. */
  features?: readonly string[];
  /** Other spellings of the name that count as the same offering. */
  aliases?: readonly string[];
  /** Decimal as text ("199000"); with `priceCurrency`. Empty = no price to compare. */
  priceAmount?: string | null;
  priceCurrency?: string | null;
  /** The price is "from …": any stated price at or above it matches. */
  priceFrom?: boolean;
  priceValidUntil?: string | Date | null;
  /** False when the offering is paused, discontinued or out of its season. */
  available: boolean;
  /** Phrases never to write about this offering (its own and its line's); found in the text → warn. */
  guardrails?: readonly string[];
  /** Names of its competitors (docs/74): naming one in a text about this offering → warn. */
  rivals?: readonly string[];
}

export interface QualityInput {
  title: string;
  body: string;
  hashtags: readonly string[];
  cta: string;
  platform: Platform;
  format: ContentFormat;
  facts?: readonly QualityFactRule[];
  /** Catalog offerings: stated prices are compared with theirs, unavailable ones are named. */
  offerings?: readonly QualityOfferingRule[];
  /**
   * The offering the content is about (docs/73): `allowedIds` are the ones it may mention (itself,
   * its line, its variants, its complements and substitutes). Another offering whose price or
   * feature the text states is `OFFERING_CROSSED`.
   */
  focus?: { offeringId: string; allowedIds: readonly string[] } | null;
  terms?: readonly TermRule[];
  /** The brand's language register; unset = not checked (docs/61). */
  register?: LanguageRegister | null;
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
export function publishText(i: Pick<QualityInput, 'body' | 'hashtags' | 'cta'>): string {
  const tags = i.hashtags
    .map(stripHash)
    .filter(Boolean)
    .map((h) => `#${h}`)
    .join(' ');
  return [i.body.trim(), i.cta.trim(), tags].filter(Boolean).join('\n\n');
}

const charCount = (s: string) => [...s].length;

const STOP_WORDS = new Set([
  'از',
  'در',
  'به',
  'با',
  'و',
  'را',
  'که',
  'این',
  'آن',
  'برای',
  'تا',
  'of',
  'the',
]);

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
      params: {
        found: t.found,
        term: t.term,
        count: t.count,
        replaceWith: t.replaceWith.join('، '),
      },
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
      if (
        expired &&
        !expiredReported &&
        (talks ||
          (normalizedValue.length >= 4 && countPhrase(normalizeTermText(sentence), fact.value) > 0))
      ) {
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

  // catalog offerings (docs/67): the price a sentence states for an offering, and offerings that
  // are not for sale; only numbers next to a currency count as prices
  for (const o of input.offerings ?? []) {
    const names = [o.name, ...(o.aliases ?? [])].filter((n) => n.trim());
    const amount = o.priceAmount ? Number(o.priceAmount) : Number.NaN;
    const priced = Number.isFinite(amount) && !!o.priceCurrency;
    const expired = priced && isFactExpired(o.priceValidUntil ?? null, now);
    let unavailableReported = false;
    let expiredReported = false;
    // never-say phrases (docs/73): a text that talks about the offering anywhere is checked whole,
    // so a promise in the next sentence is not missed
    const talksAbout = sentences.some((sentence) => names.some((n) => mentionsLabel(sentence, n)));
    if (talksAbout) {
      for (const phrase of o.guardrails ?? []) {
        const hit = sentences.find((sentence) => countPhrase(normalizeTermText(sentence), phrase) > 0);
        if (hit) {
          issues.push({
            code: 'GUARDRAIL_HIT',
            severity: 'warn',
            params: {
              name: o.name,
              phrase,
              sentence: hit.length > 140 ? `${hit.slice(0, 137)}…` : hit,
            },
          });
        }
      }
    }
    if (talksAbout) {
      for (const rival of o.rivals ?? []) {
        const hit = sentences.find((sentence) => countPhrase(normalizeTermText(sentence), rival) > 0);
        if (hit) {
          issues.push({
            code: 'ALTERNATIVE_NAMED',
            severity: 'warn',
            params: {
              name: o.name,
              rival,
              sentence: hit.length > 140 ? `${hit.slice(0, 137)}…` : hit,
            },
          });
        }
      }
    }
    for (const sentence of sentences) {
      if (!names.some((n) => mentionsLabel(sentence, n))) continue;
      if (!o.available && !unavailableReported) {
        issues.push({ code: 'OFFERING_UNAVAILABLE', severity: 'warn', params: { name: o.name } });
        unavailableReported = true;
      }
      if (!priced) continue;
      const stated = extractPrices(sentence)
        .map((p) => ({
          p,
          result: comparePrice(
            { amount, currency: o.priceCurrency!, from: o.priceFrom },
            p,
          ),
        }))
        .filter((x) => x.result !== 'incomparable');
      if (!stated.length) continue;
      if (expired) {
        if (!expiredReported) {
          issues.push({
            code: 'FACT_EXPIRED',
            severity: 'warn',
            params: {
              label: o.name,
              value: `${o.priceAmount} ${o.priceCurrency}`,
              validUntil: new Date(o.priceValidUntil!).toISOString().slice(0, 10),
            },
          });
          expiredReported = true;
        }
        continue;
      }
      if (!stated.some((x) => x.result === 'match')) {
        issues.push({
          code: 'OFFERING_PRICE_MISMATCH',
          severity: 'warn',
          params: {
            name: o.name,
            expected: `${o.priceAmount} ${o.priceCurrency}`,
            found: stated.map((x) => `${x.p.value} ${x.p.currency}`).join('، '),
            sentence: sentence.length > 140 ? `${sentence.slice(0, 137)}…` : sentence,
          },
        });
      }
    }
  }

  // a text about one offering that takes another offering's price or feature (docs/73)
  const focused = input.focus
    ? (input.offerings ?? []).find((o) => o.id === input.focus!.offeringId)
    : undefined;
  if (input.focus && focused) {
    const allowed = new Set(input.focus.allowedIds);
    const focusFeatures = new Set((focused.features ?? []).map((f) => normalizeTermText(f)));
    const focusPrice = focused.priceAmount ? Number(focused.priceAmount) : Number.NaN;
    for (const other of input.offerings ?? []) {
      if (!other.id || allowed.has(other.id) || !other.available) continue;
      const names = [other.name, ...(other.aliases ?? [])].filter((n) => n.trim());
      const otherPrice = other.priceAmount ? Number(other.priceAmount) : Number.NaN;
      const features = (other.features ?? []).filter(
        (f) => normalizeTermText(f).length >= 4 && !focusFeatures.has(normalizeTermText(f)),
      );
      for (const sentence of sentences) {
        if (!names.some((n) => mentionsLabel(sentence, n))) continue;
        const stated = extractPrices(sentence);
        // the other offering's price, when the focused one does not cost the same
        const takesPrice =
          Number.isFinite(otherPrice) &&
          !!other.priceCurrency &&
          stated.some(
            (p) =>
              comparePrice({ amount: otherPrice, currency: other.priceCurrency!, from: other.priceFrom }, p) ===
                'match' &&
              !(
                Number.isFinite(focusPrice) &&
                !!focused.priceCurrency &&
                comparePrice({ amount: focusPrice, currency: focused.priceCurrency, from: focused.priceFrom }, p) ===
                  'match'
              ),
          );
        const normalized = normalizeTermText(sentence);
        const takesFeature = features.find((f) => countPhrase(normalized, f) > 0);
        if (takesPrice || takesFeature) {
          issues.push({
            code: 'OFFERING_CROSSED',
            severity: 'warn',
            params: {
              focus: focused.name,
              other: other.name,
              what: takesPrice ? 'price' : 'feature',
              sentence: sentence.length > 140 ? `${sentence.slice(0, 137)}…` : sentence,
            },
          });
          break;
        }
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
  // language register: spoken forms in a formal brand, stiff phrases in a casual one (info only)
  if (input.register && persianShare(checked) >= 0.5) {
    const hits = registerMarkers(checked);
    const list =
      input.register === 'FORMAL' ? hits.colloquial : input.register === 'CASUAL' ? hits.stiff : [];
    if (list.length) {
      issues.push({
        code: input.register === 'FORMAL' ? 'REGISTER_COLLOQUIAL' : 'REGISTER_STIFF',
        severity: 'info',
        params: {
          count: list.reduce((n, h) => n + h.count, 0),
          example: list
            .slice(0, 3)
            .map((h) => h.text)
            .join('، '),
        },
      });
    }
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
