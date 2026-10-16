/**
 * Golden examples (docs/49-golden-examples.md): approved contents the admin marks as "this is how
 * the brand sounds". Code picks at most K of them for the prompt of a draft; the model only reads
 * them as data. Pure helpers and contracts here; loading is in the API's `ContextLoader`.
 */
import { z } from 'zod';
import type { ContentFormat, Platform } from './enums';

export const GOLDEN_MAX_EXAMPLES = 3;

/** What the admin may change without a deploy (the token cost of a draft grows with it). */
export const GoldenSettingsSchema = z.object({
  /** How many examples ride in a prompt; 0 switches the feature off. */
  maxExamples: z.number().int().min(0).max(GOLDEN_MAX_EXAMPLES).default(2),
  /** Characters of each example (title, body and call to action together). */
  maxChars: z.number().int().min(300).max(4000).default(1500),
});
export type GoldenSettings = z.infer<typeof GoldenSettingsSchema>;
export const DEFAULT_GOLDEN_SETTINGS: GoldenSettings = { maxExamples: 2, maxChars: 1500 };

export const SetGoldenSchema = z.object({ golden: z.boolean() });
export type SetGoldenInput = z.infer<typeof SetGoldenSchema>;

/** One golden content as the business page lists it. */
export interface GoldenExample {
  id: string;
  topicId: string;
  title: string;
  platform: Platform;
  format: ContentFormat;
  goldenAt: string;
  /** Start of the text, so the admin sees what the model would read. */
  excerpt: string;
  /** False when the content is no longer approved or published: it is kept but not sent to the model. */
  eligible: boolean;
}

export interface GoldenList {
  items: GoldenExample[];
  /** The admin's limits, so the page can say how many of `items` a prompt takes. */
  maxExamples: number;
  maxChars: number;
}

export interface GoldenCandidate {
  id: string;
  platform: Platform;
  format: ContentFormat;
  goldenAt: Date | string;
}

const time = (d: Date | string) => new Date(d).getTime();

/**
 * The K examples closest to what is being written: same platform and format first, then same
 * platform, then same format, then the rest; newest mark first inside each group. `excludeIds`
 * keeps the content itself and its source out. Deterministic.
 */
export function pickGoldenExamples<T extends GoldenCandidate>(
  candidates: readonly T[],
  target: { platform: Platform; format: ContentFormat; excludeIds?: readonly string[] },
  max: number,
): T[] {
  if (max <= 0) return [];
  const skip = new Set(target.excludeIds ?? []);
  const rank = (c: GoldenCandidate) =>
    (c.platform === target.platform ? 0 : 2) + (c.format === target.format ? 0 : 1);
  return candidates
    .filter((c) => !skip.has(c.id))
    .sort((a, b) => rank(a) - rank(b) || time(b.goldenAt) - time(a.goldenAt) || a.id.localeCompare(b.id))
    .slice(0, max);
}
