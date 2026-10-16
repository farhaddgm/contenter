/**
 * Several drafts of one idea, side by side (docs/51-draft-variants.md). The request path creates
 * N empty contents that share a `variantGroupId` and queues one GENERATE_CONTENT job each; every
 * job gets a different writing angle from the fixed list below (never chosen by the model).
 * Picking one is code: the others that are still drafts go to REJECTED, which `reopen` can undo.
 */
import { z } from 'zod';
import type { ContentStatus } from './enums';

export const MAX_VARIANTS = 3;

/** Writing angles, in the order they are handed out. */
export const VARIANT_ANGLES = ['DIRECT', 'STORY', 'QUESTION'] as const;
export type VariantAngle = (typeof VARIANT_ANGLES)[number];

/** What each angle asks of the model; added to the brief of that job only. */
export const VARIANT_ANGLE_INSTRUCTION: Record<VariantAngle, string> = {
  DIRECT:
    'Angle for this draft: short and direct. State the point in the first sentence, use short sentences, one idea only, no storytelling.',
  STORY:
    'Angle for this draft: narrative. Open with a small concrete scene or a short story, then draw the lesson from it.',
  QUESTION:
    'Angle for this draft: question-led. Open with the question or doubt the reader really has, then answer it step by step.',
};

export const isVariantAngle = (v: unknown): v is VariantAngle =>
  typeof v === 'string' && (VARIANT_ANGLES as readonly string[]).includes(v);

/** The angles of an N-draft request. */
export const variantAnglesFor = (n: number): VariantAngle[] =>
  VARIANT_ANGLES.slice(0, Math.max(0, Math.min(n, MAX_VARIANTS)));

/** The admin's cap on drafts per request (each draft costs one generation). */
export const VariantSettingsSchema = z.object({
  maxVariants: z.number().int().min(1).max(MAX_VARIANTS).default(MAX_VARIANTS),
});
export type VariantSettings = z.infer<typeof VariantSettingsSchema>;
export const DEFAULT_VARIANT_SETTINGS: VariantSettings = { maxVariants: MAX_VARIANTS };

export interface VariantMember {
  id: string;
  status: ContentStatus;
  hasVersion: boolean;
}

export type PickRefusal = 'not_in_group' | 'not_draft' | 'still_generating';

export type PickPlan =
  { ok: true; reject: string[]; keep: string[] } | { ok: false; reason: PickRefusal };

/**
 * What picking `chosenId` does: the chosen draft must be a DRAFT with text and no other draft of
 * the group may still be generating (its text would arrive after the choice). The other drafts
 * that are DRAFT or FAILED are rejected; any that already entered review or were approved stay
 * (`keep`), because a person already acted on them.
 */
export function planPick(group: readonly VariantMember[], chosenId: string): PickPlan {
  const chosen = group.find((m) => m.id === chosenId);
  if (!chosen) return { ok: false, reason: 'not_in_group' };
  if (chosen.status !== 'DRAFT' || !chosen.hasVersion) return { ok: false, reason: 'not_draft' };
  if (group.some((m) => m.id !== chosenId && m.status === 'GENERATING')) {
    return { ok: false, reason: 'still_generating' };
  }
  const others = group.filter((m) => m.id !== chosenId);
  return {
    ok: true,
    reject: others.filter((m) => m.status === 'DRAFT' || m.status === 'FAILED').map((m) => m.id),
    keep: others.filter((m) => m.status !== 'DRAFT' && m.status !== 'FAILED').map((m) => m.id),
  };
}

/** One draft of the compare page; the numbers are computed by code. */
export interface VariantItem {
  id: string;
  status: ContentStatus;
  angle: VariantAngle | null;
  title: string;
  body: string;
  hashtags: string[];
  cta: string;
  /** Characters of the publishable text. */
  length: number;
  maxChars: number | null;
  /** Quality-gate warnings that need no business data (limits, typography, placeholders). */
  warnings: number;
  avgSentenceWords: number;
  readabilityNotes: number;
  /** The highest literal similarity (0–1) to another draft of the group; null for a lone draft. */
  similarTo: number | null;
}

export interface VariantGroup {
  groupId: string | null;
  topicId: string;
  items: VariantItem[];
}
