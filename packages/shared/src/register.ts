/**
 * Language register of a brand (docs/61-occasions-register-stale.md): formal, standard or
 * casual (spoken) Persian. The admin picks it per business; the model gets one line about it with
 * the profile, and CODE checks the text against two fixed marker lists. A hit is an informational
 * note, never a block, and the model never judges the register.
 */
import { countPhrase, normalizeTermText } from './business-profile';
import { DEFAULT_STIFF_PHRASES } from './readability';
import type { LanguageRegister } from './register-enum';

const L = '\\p{L}';
const word = (body: string) => new RegExp(`(?<!${L})(?:${body})(?!${L})`, 'gu');

/**
 * Spoken-only forms (on text where half-space = space): "می‌خوام", "نمی‌دونم", "می‌شه",
 * "خوبه", "اینجوری", "بهش". Standard written verbs ("می‌خواهم", "می‌گیرم") do not match.
 */
const COLLOQUIAL: RegExp[] = [
  word('ن?می ?(?:خوا(?:م|ی|یم|ین|ن)|تون(?:م|ی|یم|ین|ن)|دون(?:م|ی|یم|ین|ن)|گ(?:م|ی|یم|ین|ن)|شه|شن)'),
  word('(?:خوب|عالی|قشنگ|مهم|لازم|درست|سخت|آسون|ارزون|گرون|باحال|جالب|زیبا|بهتر|بد)ه'),
  word('یه|اینجوری|اونجوری|همینجوری|چطوری|چیه|کیه|بهش|ازش|باهاش|براش|برام|برات|بهت|ازت|باهات'),
];

export interface RegisterHits {
  colloquial: { text: string; count: number }[];
  stiff: { text: string; count: number }[];
}

/** Marker words found in a text, most frequent first. Pure. */
export function registerMarkers(text: string, extraStiff: readonly string[] = []): RegisterHits {
  const hay = normalizeTermText(text);
  const colloquial = new Map<string, number>();
  for (const re of COLLOQUIAL) {
    for (const m of hay.matchAll(re)) colloquial.set(m[0], (colloquial.get(m[0]) ?? 0) + 1);
  }
  const stiff: { text: string; count: number }[] = [];
  const phrases = [...new Set([...DEFAULT_STIFF_PHRASES, ...extraStiff])].sort(
    (a, b) => b.length - a.length,
  );
  let rest = hay;
  for (const phrase of phrases) {
    const count = countPhrase(rest, phrase);
    if (!count) continue;
    stiff.push({ text: phrase, count });
    // the phrase is matched literally, so the characters that mean something in a pattern are escaped
    const n = [...normalizeTermText(phrase)]
      .map((ch) => (/[\w\s]|[^\x00-\x7f]/.test(ch) ? ch : `\\${ch}`))
      .join('');
    rest = rest.replace(new RegExp(`(?<!${L})${n}(?!${L})`, 'gu'), ' ');
  }
  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    colloquial: [...colloquial].map(([t, count]) => ({ text: t, count })).sort(byCount),
    stiff: stiff.sort(byCount),
  };
}

/** The one line the model gets with the business profile (data, not prompt text). */
export function registerInstruction(register: LanguageRegister | null | undefined): string | null {
  switch (register) {
    case 'FORMAL':
      return 'Language register: FORMAL written Persian. Never use spoken contractions (e.g. "می‌خوام", "خوبه", "اینجوری"); write "می‌خواهم", "خوب است", "این‌گونه".';
    case 'CASUAL':
      return 'Language register: CASUAL, friendly spoken Persian is welcome. Avoid stiff bureaucratic phrasing (e.g. "می‌باشد", "در خصوص", "به منظور").';
    case 'STANDARD':
      return 'Language register: STANDARD everyday written Persian — neither bureaucratic nor slangy.';
    default:
      return null;
  }
}
