import type { ZodType } from 'zod';
import type { AiEffort, AiJobType } from '@contenter/shared';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
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
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
