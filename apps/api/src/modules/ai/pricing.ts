import type { AiUsage } from './provider/ai-provider';

/** USD per 1M tokens. Update when vendor pricing changes; unknown models cost 0. */
interface Price {
  input: number;
  output: number;
  /** Multipliers on `input` (defaults: Anthropic's 0.1 read / 1.25 write). */
  cacheRead?: number;
  cacheWrite?: number;
}

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // OpenAI — cached input is billed at a discount, there is no cache-write charge.
  'gpt-5.2': { input: 1.75, output: 14, cacheRead: 0.1, cacheWrite: 0 },
  'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.1, cacheWrite: 0 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.1, cacheWrite: 0 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.1, cacheWrite: 0 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 0.5, cacheWrite: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.5, cacheWrite: 0 },
  o3: { input: 2, output: 8, cacheRead: 0.25, cacheWrite: 0 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.25, cacheWrite: 0 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(model: string): Price | undefined {
  // Tolerate prefixes ("mock/", "openai:") and dated snapshot suffixes ("gpt-5-2025-08-07").
  const id = model.replace(/^.*[/:]/, '').replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, '');
  return PRICES[id];
}

export function estimateCostUsd(model: string, usage: AiUsage): number {
  if (model.startsWith('mock/')) return 0;
  const p = priceFor(model);
  if (!p) return 0;
  const cost =
    (usage.inputTokens * p.input +
      usage.cacheReadTokens * p.input * (p.cacheRead ?? CACHE_READ_MULTIPLIER) +
      usage.cacheWriteTokens * p.input * (p.cacheWrite ?? CACHE_WRITE_MULTIPLIER) +
      usage.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
