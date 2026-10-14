import type { ZodType } from 'zod';
import type { AiEffort, AiJobType } from '@contenter/shared';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Server-side web searches run by the vendor (billed per search). */
  webSearches?: number;
  /** Answered through the vendor's batch API, billed at about half price (docs/44). */
  batch?: boolean;
}

export interface ResearchRequest {
  task: AiJobType;
  model: string;
  effort: AiEffort;
  system: string;
  user: string;
  /** Upper bound on web searches for this request. */
  maxSearches: number;
  /** `host` / `host/path` values the vendor search must skip (where the tool supports it). */
  blockedDomains?: string[];
  /** When set, the vendor search may only return pages of these hosts (subdomains included). */
  allowedDomains?: string[];
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

/** Why a vendor could not serve a request at all (as opposed to rejecting this one request). */
export type UnavailableReason = 'quota' | 'auth' | 'overloaded' | 'network';

/**
 * The vendor is out of credit or refuses our key or permission. Retrying the same call cannot
 * help, so it is non-retryable; the executor may still switch to the fallback model.
 */
export class ProviderUnavailableError extends NonRetryableAiError {
  constructor(
    message: string,
    readonly reason: UnavailableReason,
  ) {
    super(message);
  }
}

/** The vendor is overloaded or unreachable after the SDK's own retries; the queue may retry. */
export class ProviderOverloadedError extends Error {
  constructor(
    message: string,
    readonly reason: UnavailableReason,
  ) {
    super(message);
  }
}

/** True for any error that means "this vendor cannot serve us now" — the cue for the fallback. */
export const isProviderDown = (err: unknown): err is ProviderUnavailableError | ProviderOverloadedError =>
  err instanceof ProviderUnavailableError || err instanceof ProviderOverloadedError;

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

// ─────────────────────────────── batch mode ───────────────────────────────

/** What a vendor's batch returned for one request. */
export type BatchItemResult = { ok: true; raw: unknown } | { ok: false; error: string };

/** State of a submitted batch; `results` is keyed by the `customId` of each request. */
export type BatchPoll =
  | { state: 'running' }
  | { state: 'done'; results: Record<string, BatchItemResult> }
  | { state: 'failed'; error: string };

/**
 * Optional capability of a provider: structured calls through the vendor's batch API (about half
 * the price, an answer within 24 hours). Used by economy-mode jobs (docs/44). A request is
 * turned into plain JSON when the call is made (`buildBatchParams`), submitted later together
 * with others (`submitBatch`), and the raw answer is read back with the task's schema
 * (`parseBatchResult`).
 */
export interface BatchProvider {
  buildBatchParams(req: StructuredRequest<unknown>): Promise<Record<string, unknown>>;
  submitBatch(
    items: { customId: string; params: Record<string, unknown> }[],
  ): Promise<{ batchRef: string }>;
  pollBatch(batchRef: string): Promise<BatchPoll>;
  parseBatchResult<T>(raw: unknown, schema: ZodType<T>): StructuredResult<T>;
}

export const isBatchProvider = (p: AiProvider): p is AiProvider & BatchProvider =>
  typeof (p as Partial<BatchProvider>).submitBatch === 'function';

/** Adds up usage of several calls made for one job. */
export function sumUsage(...items: AiUsage[]): AiUsage {
  const total = items.reduce<AiUsage>(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + u.cacheWriteTokens,
      webSearches: (acc.webSearches ?? 0) + (u.webSearches ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 },
  );
  // half price only when every call of the job was a batch call
  return items.length > 0 && items.every((u) => u.batch) ? { ...total, batch: true } : total;
}

/**
 * Sources of a research run: the pages the notes rely on — cited by the model, or named by URL
 * in the notes. Search hits the model saw but did not use are not sources; listing them fills
 * the admin's source list with unrelated pages. Only when the notes reference nothing at all do
 * the raw hits stand in.
 */
export function researchSources(
  cited: { url: string; title: string }[],
  found: { url: string; title: string }[],
  notes = '',
): { url: string; title: string }[] {
  const titles = new Map(
    found.filter((f) => f.title && f.title !== f.url).map((f) => [f.url, f.title]),
  );
  const used = [...cited, ...found.filter((f) => f.url && notes.includes(f.url))];
  return mergeSources(
    (used.length ? used : found).map((s) => ({
      url: s.url,
      title: s.title && s.title !== s.url ? s.title : (titles.get(s.url) ?? ''),
    })),
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
