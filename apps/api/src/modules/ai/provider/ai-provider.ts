import type { ZodType } from 'zod';
import type { AiEffort, AiJobType } from '@contenter/shared';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Server-side web searches run by the vendor (billed per search). */
  webSearches?: number;
}

export interface ResearchRequest {
  task: AiJobType;
  model: string;
  effort: AiEffort;
  system: string;
  user: string;
  /** Upper bound on web searches for this request. */
  maxSearches: number;
  maxTokens?: number;
}

export interface ResearchResult {
  /** Research notes in Markdown (free text — the structuring step turns it into JSON). */
  text: string;
  /** Pages the vendor's web search returned or cited, de-duplicated by URL. */
  sources: { url: string; title: string }[];
  model: string;
  usage: AiUsage;
}

export interface StructuredRequest<T> {
  /** Which task is running — providers may use it for routing/mocking. */
  task: AiJobType;
  model: string;
  effort: AiEffort;
  /** Stable instructions (cached). */
  system: string;
  /** Volatile, per-request content. */
  user: string;
  /** Optional public image URLs to include as vision input. */
  imageUrls?: string[];
  schema: ZodType<T>;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: AiUsage;
}

/** Raised for failures that retrying will not fix (refusals, invalid output). */
export class NonRetryableAiError extends Error {
  readonly nonRetryable = true;
}

/**
 * The only boundary between Contenter and an LLM vendor.
 * Implementations must return data that already passed `schema` validation.
 */
export interface AiProvider {
  readonly name: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  /**
   * Free-text research with the vendor's server-side web search tool. Kept separate from
   * `generateStructured` because search citations and strict JSON output do not mix; runners
   * research first, then structure the notes.
   */
  research(req: ResearchRequest): Promise<ResearchResult>;
}

/** Adds up usage of several calls made for one job. */
export function sumUsage(...items: AiUsage[]): AiUsage {
  return items.reduce<AiUsage>(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + u.cacheWriteTokens,
      webSearches: (acc.webSearches ?? 0) + (u.webSearches ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 },
  );
}

/** Adds sources, keeping the first occurrence of each URL. */
export function mergeSources(
  ...lists: { url: string; title: string }[][]
): { url: string; title: string }[] {
  const seen = new Map<string, { url: string; title: string }>();
  for (const s of lists.flat()) {
    const url = s.url.trim();
    if (url && !seen.has(url)) seen.set(url, { url, title: s.title?.trim() || url });
  }
  return [...seen.values()];
}
