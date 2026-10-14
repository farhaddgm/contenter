/**
 * Model routing by cost (docs/44-reliability-and-cost.md): heavy tasks get a strong model, light
 * ones a cheap model. Pure suggestion; the admin applies it from Settings and can still change
 * every task by hand.
 */
import type { AiJobType } from './enums';

export type AiTaskWeight = 'heavy' | 'light';

/**
 * Heavy: long, high-stakes text that the team publishes or that shapes everything after it (a
 * wrong profile or principle poisons later drafts). Light: short rewrites, analysis of one
 * sample, suggestions the admin reviews anyway.
 */
export const AI_TASK_WEIGHT: Record<AiJobType, AiTaskWeight> = {
  GENERATE_CONTENT: 'heavy',
  BUILD_PROFILE: 'heavy',
  BUSINESS_BUILD: 'heavy',
  BUSINESS_REVISE: 'heavy',
  BUSINESS_AUDIT: 'heavy',
  LEARN_FROM_EDITS: 'heavy',
  REVISE_CONTENT: 'light',
  REPURPOSE_CONTENT: 'light',
  IDEATE: 'light',
  ANALYZE_SAMPLE: 'light',
  SMART_CHAT: 'light',
  BUSINESS_DISCOVER: 'light',
  BUSINESS_SUGGEST: 'light',
  BUSINESS_ASSET_ANALYZE: 'light',
};

/**
 * Per-task model map for a strong and a cheap model. `default` follows the strong model so a new
 * task type is never silently routed to the cheap one.
 */
export function suggestRouting(strong: string, light: string): Record<string, string> {
  const models: Record<string, string> = { default: strong };
  for (const [task, weight] of Object.entries(AI_TASK_WEIGHT)) {
    models[task] = weight === 'heavy' ? strong : light;
  }
  return models;
}
