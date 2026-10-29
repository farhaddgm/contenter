/**
 * What the model reads about a business (docs/66-business-context-preview.md): the blocks of the
 * `business` prompt variable with their size, plus a rough token and cost estimate. Everything
 * here is arithmetic on the text the prompt builder already produced — no model is involved.
 */
import { z } from 'zod';
import type { BusinessSectionKey } from './business';

/** Which kind of job the preview is for (the blocks differ: examples and style only reach drafts). */
export const ContextTarget = ['DRAFT', 'IDEATE', 'PROFILE'] as const;
export type ContextTarget = (typeof ContextTarget)[number];

export const ContextPreviewQuerySchema = z.object({
  target: z.enum(ContextTarget).default('DRAFT'),
  /** A project of the business: needed to see the documents, examples and style it would get. */
  topicId: z.string().trim().min(1).max(64).optional(),
});
export type ContextPreviewQuery = z.input<typeof ContextPreviewQuerySchema>;

export type ContextBlockId =
  | 'HEAD'
  | `SECTION:${BusinessSectionKey}`
  | 'FACTS'
  | 'CATALOG'
  | 'FOCUS'
  | 'TERMS'
  | 'ASSETS'
  | 'DOCUMENTS'
  | 'EXAMPLES'
  | 'STYLE';

export interface ContextBlock {
  id: ContextBlockId;
  /** Length of `text` in characters, the unit every prompt budget is counted in. */
  chars: number;
  estTokens: number;
  /** The builder cut this block's text or left items out (see `omitted`). */
  cut: boolean;
  /** Items the builder left out ("N more omitted"); 0 when none or unknown. */
  omitted: number;
  /** An AI-written section the admin has not confirmed yet. */
  unreviewed: boolean;
  text: string;
}

export const ContextWarningCode = [
  'SECTION_CUT',
  'BLOCK_OMITTED',
  'UNREVIEWED_AI',
  'DOCUMENTS_DOMINATE',
  'NO_FACTS',
] as const;
export type ContextWarningCode = (typeof ContextWarningCode)[number];

export interface ContextWarning {
  code: ContextWarningCode;
  /** Block ids the warning is about, or a count for `UNREVIEWED_AI`. */
  blocks: ContextBlockId[];
  count: number;
}

export interface ContextRatio {
  charsPerToken: number;
  source: 'DEFAULT' | 'MEASURED';
  samples: number;
}

export interface ContextReport {
  target: ContextTarget;
  /** The project the documents, examples and style were taken from, if any. */
  topicId: string | null;
  blocks: ContextBlock[];
  totalChars: number;
  estTokens: number;
  /** Input cost of one job at the task model's price; null for non-admins or an unknown price. */
  estCostUsd: number | null;
  /** The model whose price and token ratio were used. */
  model: string | null;
  ratio: ContextRatio;
  warnings: ContextWarning[];
  /** Blocks that need a project to be shown (documents, examples, style). */
  needsTopic: boolean;
}

/**
 * Placeholder until enough measured jobs exist. Persian costs more tokens per character than
 * English; the real ratio for the production model must be measured (docs/66 §2.1), so this
 * number is deliberately labelled "approximate" wherever it is shown.
 */
export const DEFAULT_CHARS_PER_TOKEN = 2.5;
/** Fewest measured jobs before the measured ratio replaces the default. */
export const MIN_RATIO_SAMPLES = 20;
/** Most recent jobs the ratio is measured from. */
export const RATIO_SAMPLE_JOBS = 100;
/** The measured ratio is clamped here so one odd job cannot make estimates absurd. */
const MIN_CHARS_PER_TOKEN = 1;
const MAX_CHARS_PER_TOKEN = 6;
/** A block this big a share of the total is called out. */
export const DOMINANT_SHARE = 0.5;

export function estimateTokens(chars: number, charsPerToken: number): number {
  if (chars <= 0 || !(charsPerToken > 0)) return 0;
  return Math.ceil(chars / charsPerToken);
}

export interface RatioSample {
  /** Characters of the whole prompt (system + user) the job sent. */
  chars: number;
  /** Input tokens the vendor billed for it. */
  tokens: number;
}

/** Characters per token measured from finished jobs; the default while there are too few. */
export function calibrateRatio(samples: readonly RatioSample[]): ContextRatio {
  const usable = samples.filter((s) => s.chars > 0 && s.tokens > 0);
  if (usable.length < MIN_RATIO_SAMPLES) {
    return { charsPerToken: DEFAULT_CHARS_PER_TOKEN, source: 'DEFAULT', samples: usable.length };
  }
  const chars = usable.reduce((sum, s) => sum + s.chars, 0);
  const tokens = usable.reduce((sum, s) => sum + s.tokens, 0);
  const raw = chars / tokens;
  const charsPerToken = Math.round(Math.min(MAX_CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, raw)) * 100) / 100;
  return { charsPerToken, source: 'MEASURED', samples: usable.length };
}

/** Facts a reader should notice, all counted from the blocks (never judged by a model). */
export function contextWarnings(blocks: readonly ContextBlock[]): ContextWarning[] {
  const out: ContextWarning[] = [];
  const cutSections = blocks.filter((b) => b.id.startsWith('SECTION:') && b.cut);
  if (cutSections.length) {
    out.push({ code: 'SECTION_CUT', blocks: cutSections.map((b) => b.id), count: cutSections.length });
  }
  const omitted = blocks.filter((b) => !b.id.startsWith('SECTION:') && b.cut);
  if (omitted.length) {
    out.push({ code: 'BLOCK_OMITTED', blocks: omitted.map((b) => b.id), count: omitted.length });
  }
  const unreviewed = blocks.filter((b) => b.unreviewed);
  if (unreviewed.length) {
    out.push({ code: 'UNREVIEWED_AI', blocks: unreviewed.map((b) => b.id), count: unreviewed.length });
  }
  const total = blocks.reduce((sum, b) => sum + b.chars, 0);
  const docs = blocks.find((b) => b.id === 'DOCUMENTS');
  if (docs && total > 0 && docs.chars / total > DOMINANT_SHARE) {
    out.push({ code: 'DOCUMENTS_DOMINATE', blocks: ['DOCUMENTS'], count: 1 });
  }
  if (!blocks.some((b) => b.id === 'FACTS')) {
    out.push({ code: 'NO_FACTS', blocks: [], count: 0 });
  }
  return out;
}

/** Adds token estimates to the blocks and assembles the report. Pure. */
export function buildContextReport(args: {
  target: ContextTarget;
  topicId: string | null;
  blocks: readonly Omit<ContextBlock, 'estTokens'>[];
  ratio: ContextRatio;
  model: string | null;
  /** USD per 1M input tokens, or null when unknown / not to be shown. */
  inputPricePerMillion: number | null;
  needsTopic: boolean;
}): ContextReport {
  const blocks: ContextBlock[] = args.blocks.map((b) => ({
    ...b,
    estTokens: estimateTokens(b.chars, args.ratio.charsPerToken),
  }));
  const totalChars = blocks.reduce((sum, b) => sum + b.chars, 0);
  // the join between blocks (two newlines each) is part of the prompt too
  const glue = Math.max(0, blocks.length - 1) * 2;
  const estTokens = estimateTokens(totalChars + glue, args.ratio.charsPerToken);
  const estCostUsd =
    args.inputPricePerMillion === null
      ? null
      : Math.round(((estTokens * args.inputPricePerMillion) / 1_000_000) * 1_000_000) / 1_000_000;
  return {
    target: args.target,
    topicId: args.topicId,
    blocks,
    totalChars: totalChars + glue,
    estTokens,
    estCostUsd,
    model: args.model,
    ratio: args.ratio,
    warnings: contextWarnings(blocks),
    needsTopic: args.needsTopic,
  };
}
