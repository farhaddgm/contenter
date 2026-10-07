/**
 * Search helpers shared by the API (building the query, picking a snippet) and the web
 * (highlighting). Persian text is typed with two keyboards, so the Arabic and Persian forms of
 * ی/ک, the three digit scripts and ZWNJ-versus-space all have to match each other.
 */

export const SEARCH_MAX_TERMS = 5;
/** Spellings of one term the database is asked for (the database does not fold them for us). */
export const SEARCH_MAX_VARIANTS = 8;

const YEH = ['ی', 'ي'] as const; // ی  ي
const KAF = ['ک', 'ك'] as const; // ک  ك
const DIGIT_SCRIPTS = ['0123456789', '۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩'] as const;

const FOLD_MAP = new Map<string, string>([
  ['ي', 'ی'], // ي → ی
  ['ى', 'ی'], // ى → ی
  ['ك', 'ک'], // ك → ک
  ['‌', ' '], // ZWNJ → space
  ['‏', ' '], // RLM
]);
DIGIT_SCRIPTS.slice(1).forEach((script) =>
  [...script].forEach((ch, i) => FOLD_MAP.set(ch, String(i))),
);

/**
 * One canonical spelling for comparing. It maps every character to exactly one character, so a
 * position in the folded text is the same position in the original (snippets rely on this).
 */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) out += FOLD_MAP.get(ch) ?? ch.toLowerCase();
  return out;
}

/** The words of a query, deduplicated and capped; quotes and punctuation around them go. */
export function searchTerms(q: string): string[] {
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter(Boolean);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const w of words) {
    const key = fold(w);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(w);
    if (terms.length === SEARCH_MAX_TERMS) break;
  }
  return terms;
}

/** Every keyboard spelling of a term that the database should match (`contains`, insensitive). */
export function termVariants(term: string): string[] {
  let forms = new Set([term]);
  const expand = (variants: readonly string[]) => {
    const present = variants.some((v) => term.includes(v));
    if (!present) return;
    const next = new Set<string>();
    for (const form of forms) {
      for (const v of variants) {
        let swapped = form;
        for (const other of variants) swapped = swapped.split(other).join(v);
        next.add(swapped);
      }
    }
    forms = next;
  };
  expand(YEH);
  expand(KAF);
  // digits: only when the term has some, and each script is tried
  const digitScript = DIGIT_SCRIPTS.find((s) => [...s].some((d) => term.includes(d)));
  if (digitScript) {
    const next = new Set<string>();
    for (const form of forms) {
      for (const script of DIGIT_SCRIPTS) {
        let swapped = form;
        for (const s of DIGIT_SCRIPTS) {
          [...s].forEach((d, i) => (swapped = swapped.split(d).join(script[i]!)));
        }
        next.add(swapped);
      }
    }
    forms = next;
  }
  // a half-space in the term also appears as a plain space in sloppily typed text
  for (const form of [...forms]) if (form.includes('‌')) forms.add(form.replaceAll('‌', ' '));
  return [...forms].slice(0, SEARCH_MAX_VARIANTS);
}

/** Positions of every term in `text`, folded, as [start, end) pairs sorted and merged. */
export function matchRanges(text: string, terms: string[]): [number, number][] {
  const hay = fold(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const needle = fold(term);
    if (!needle) continue;
    for (
      let from = hay.indexOf(needle);
      from !== -1;
      from = hay.indexOf(needle, from + needle.length)
    ) {
      ranges.push([from, from + needle.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** How many times the terms occur in `text`. */
export const countMatches = (text: string, terms: string[]) => matchRanges(text, terms).length;

/**
 * A short excerpt around the first match, on word borders, with "…" where it was cut. Empty when
 * nothing matches. Whitespace is collapsed so Markdown line breaks do not eat the budget.
 */
export function makeSnippet(text: string, terms: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, ' ');
  const first = matchRanges(flat, terms)[0];
  if (!first) return '';
  let start = Math.max(0, first[0] - radius);
  let end = Math.min(flat.length, first[1] + radius);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < first[0]) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > first[1]) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Splits `text` into pieces, each flagged when it is a match, for highlighting. */
export function highlightParts(text: string, terms: string[]): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [from, to] of matchRanges(text, terms)) {
    if (from > at) parts.push({ text: text.slice(at, from), match: false });
    parts.push({ text: text.slice(from, to), match: true });
    at = to;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}
