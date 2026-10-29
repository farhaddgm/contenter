/**
 * The focus of a project or a content (docs/73-offering-hierarchy.md §4): the one offering and the
 * one audience a piece is about. A prompt for it carries the offering with the line it belongs to
 * and the audience in full (`[FOCUS]`), and the quality gate warns when the text takes another
 * offering's terms (`OFFERING_CROSSED`). Labels are set by people; the model chooses nothing.
 */
import { z } from 'zod';
import type { TreeNode } from './offering-tree';
import { offeringAncestors } from './offering-tree';
import type { OfferingCore } from './business-catalog';
import type { SegmentKind } from './business-segments';

/** Total text of the `[FOCUS]` block in one prompt. */
export const MAX_FOCUS_TEXT = 4_000;
/** Names of the neighbouring offerings listed so the model does not mix their terms in. */
export const FOCUS_SIBLINGS_MAX = 8;
/** Audiences of the focused offering shown in full when none was chosen (main audiences first). */
export const FOCUS_SEGMENTS_MAX = 3;

const focusId = z.string().trim().min(1).max(64).nullish();

/** Fields a topic and a content carry; `null` clears, absent leaves as it is. */
export const FocusFieldsSchema = z.object({
  offeringId: focusId,
  segmentId: focusId,
});
export type FocusFields = z.infer<typeof FocusFieldsSchema>;

/** One audience as the prompt prints it. */
export interface FocusSegmentForPrompt {
  kind: SegmentKind;
  name: string;
  summary: string;
  goals: string[];
  pains: string[];
  objections: string[];
  channels: string[];
  messageAngle: string;
}

/** The effective focus a job is written for (read by `BusinessApi.focusForPrompt`). */
export interface FocusForPrompt {
  /** The offering and the usable lines above it, root first; empty = no usable offering in focus. */
  chain: OfferingCore[];
  /** Names of the other usable offerings under the same line (or the other lines). */
  siblings: string[];
  segments: FocusSegmentForPrompt[];
  /** The admin chose the audience (otherwise it comes from the offering's links). */
  segmentChosen: boolean;
}

/** The content's own focus wins; what it leaves empty comes from its project. */
export function effectiveFocus(
  content: { offeringId?: string | null; segmentId?: string | null } | null | undefined,
  topic: { offeringId?: string | null; segmentId?: string | null },
): { offeringId: string | null; segmentId: string | null } {
  return {
    offeringId: content?.offeringId ?? topic.offeringId ?? null,
    segmentId: content?.segmentId ?? topic.segmentId ?? null,
  };
}

/**
 * Offerings a text about `focusId` may mention without taking their terms: the offering itself, the
 * lines above it, the variants below it, and the ones the admin named as complements or substitutes.
 */
export function focusAllowedIds(
  focusId: string,
  rows: readonly (TreeNode & { id: string; complementIds?: readonly string[]; substituteIds?: readonly string[] })[],
): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const allowed = new Set<string>([focusId, ...offeringAncestors(focusId, byId)]);
  for (const r of rows) if (offeringAncestors(r.id, byId).includes(focusId)) allowed.add(r.id);
  const self = byId.get(focusId);
  for (const id of [...(self?.complementIds ?? []), ...(self?.substituteIds ?? [])]) allowed.add(id);
  return [...allowed];
}
