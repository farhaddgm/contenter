import type { AiUsage } from './provider/ai-provider';

/** USD per 1M tokens. Update when Anthropic pricing changes. */
interface Price {
  input: number;
  output: number;
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
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(model: string): Price | undefined {
  if (PRICES[model]) return PRICES[model];
  // Tolerate prefixes like "mock/claude-opus-5" or dated suffixes.
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.includes(k));
  return key ? PRICES[key] : undefined;
}

export function estimateCostUsd(model: string, usage: AiUsage): number {
  if (model.startsWith('mock/')) return 0;
  const p = priceFor(model);
  if (!p) return 0;
  const cost =
    (usage.inputTokens * p.input +
      usage.cacheReadTokens * p.input * CACHE_READ_MULTIPLIER +
      usage.cacheWriteTokens * p.input * CACHE_WRITE_MULTIPLIER +
      usage.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
