/**
 * Learning from human edits (docs/30-learn-from-edits.md). When an editor changes an AI draft and
 * the result is approved, the difference is a quality signal. Code finds the (AI version, approved
 * version) pairs and computes the diffs; the model only names patterns that repeat across pairs and
 * proposes principles; the admin accepts or dismisses each one. Nothing changes without that.
 */
import { z } from 'zod';
import { PrincipleKind } from './enums';

/** Fewer edited approved contents than this and there is nothing to learn from yet. */
export const MIN_EDIT_PAIRS = 6;
/** The newest pairs given to the model in one run (keeps the prompt small and current). */
export const MAX_EDIT_PAIRS = 12;
/** A suggestion must be backed by at least this many different pairs: one edit is not a pattern. */
export const MIN_EVIDENCE_PAIRS = 2;
/** At most this many suggestions are kept per run. */
export const MAX_EDIT_SUGGESTIONS = 5;
/** Below this share of changed words an edit is a typo fix, not something to learn from. */
export const MIN_CHANGE_RATIO = 0.03;
/** Longest excerpt kept as evidence of one suggestion in one pair. */
export const EVIDENCE_EXCERPT_CHARS = 240;

/** What kind of change the pattern is about; a closed list so the UI can group and filter. */
export const EditCategory = [
  'LENGTH',
  'OPENING',
  'TONE',
  'TERMINOLOGY',
  'FACTS',
  'STRUCTURE',
  'CTA',
  'FORMATTING',
  'CLARITY',
  'OTHER',
] as const;
export type EditCategory = (typeof EditCategory)[number];

/** What the model returns: patterns, each pointing at the pairs (P1, P2 …) that show it. */
export const EditLearningResultSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z.enum(PrincipleKind),
        category: z.enum(EditCategory),
        /** The proposed principle, written as an instruction to the writer. */
        text: z.string().min(5).max(300),
        /** Why: which pattern the pairs show. */
        rationale: z.string().max(600).default(''),
        /** Ids from the prompt (P1, P2 …); the server checks every one. */
        evidence: z.array(z.string().min(1).max(12)).min(1).max(MAX_EDIT_PAIRS),
      }),
    )
    .max(MAX_EDIT_SUGGESTIONS * 2),
});
export type EditLearningResult = z.infer<typeof EditLearningResultSchema>;

/** One verified example behind a suggestion, built by code from a real pair. */
export interface EditEvidence {
  contentId: string;
  contentTitle: string;
  /** Version number of the AI draft and of the approved text. */
  fromVersion: number;
  toVersion: number;
  /** Share of words that changed, 0–1. */
  changeRatio: number;
  /** The first changed passage, with `{-removed-}` and `{+added+}` markers. */
  excerpt: string;
}

export type LearningSuggestionStatus = 'PENDING' | 'ACCEPTED' | 'DISMISSED';

export interface LearningSuggestion {
  id: string;
  topicId: string;
  runId: string;
  kind: PrincipleKind;
  category: EditCategory;
  text: string;
  rationale: string;
  evidence: EditEvidence[];
  status: LearningSuggestionStatus;
  /** The principle created when accepted. */
  principleId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** The numbers shown above the suggestions; all counted by code, no AI. */
export interface EditLearningStats {
  /** Approved contents of the topic. */
  approved: number;
  /** Of those, the ones whose approved text is an editor's change of an AI draft. */
  edited: number;
  /** Approved without a human change: the draft was good enough. */
  unedited: number;
  /** `unedited / approved`, 0–1, or null when nothing is approved yet. */
  uneditedShare: number | null;
}

export interface EditLearningOverview {
  stats: EditLearningStats;
  minPairs: number;
  /** Enough edited contents to ask for an analysis. */
  eligible: boolean;
  /** An analysis that is queued or running, if any. */
  activeJob: { id: string; status: 'QUEUED' | 'RUNNING' } | null;
  /** When the last analysis finished, if ever. */
  lastRunAt: string | null;
  pending: LearningSuggestion[];
  /** Accepted and dismissed ones, newest first (the last 20). */
  decided: LearningSuggestion[];
}

/** The admin may reword the suggestion, or change its kind, when accepting it. */
export const AcceptLearningSuggestionSchema = z.object({
  text: z.string().trim().min(3).max(300).optional(),
  kind: z.enum(PrincipleKind).optional(),
});
export type AcceptLearningSuggestionInput = z.infer<typeof AcceptLearningSuggestionSchema>;
