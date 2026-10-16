/**
 * People's verdict on what the AI wrote (docs/46-ai-feedback.md): one 👍 or 👎 per person and
 * output, with a reason for a 👎. Each vote points at the AI job that made the output, so votes
 * can be counted per prompt version and model, and they become the raw material of the Persian
 * eval (docs/43). Counted by code.
 */
import { z } from 'zod';
import type { AiJobType } from './enums';

/** The outputs that can be rated. (Ideas have their own "reject"; sample analyses may follow.) */
export const FeedbackTarget = ['CONTENT_VERSION', 'PROFILE'] as const;
export type FeedbackTarget = (typeof FeedbackTarget)[number];

export const FeedbackRating = ['UP', 'DOWN'] as const;
export type FeedbackRating = (typeof FeedbackRating)[number];

/** Why a draft got a 👎. A plain string column, so the list can grow without a migration. */
export const FeedbackReason = [
  'WRONG_FACT',
  'TONE',
  'DUPLICATE',
  'TOO_LONG',
  'TOO_SHORT',
  'TRANSLATED_FEEL',
  'OFF_TOPIC',
  'OTHER',
] as const;
export type FeedbackReason = (typeof FeedbackReason)[number];

export const FEEDBACK_NOTE_MAX_CHARS = 1000;

export const SetFeedbackSchema = z
  .object({
    rating: z.enum(FeedbackRating),
    reason: z.enum(FeedbackReason).nullish(),
    note: z.string().trim().max(FEEDBACK_NOTE_MAX_CHARS).optional(),
  })
  // a reason only explains a 👎
  .refine((v) => v.rating === 'DOWN' || (!v.reason && !v.note), {
    message: 'A reason or a note goes with a thumbs-down only',
    path: ['reason'],
  });
export type SetFeedbackInput = z.input<typeof SetFeedbackSchema>;

export const FeedbackMineQuerySchema = z.object({
  targetType: z.enum(FeedbackTarget),
  topicId: z.string().min(1).max(40),
});
export type FeedbackMineQuery = z.infer<typeof FeedbackMineQuerySchema>;

export const FeedbackSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});
export type FeedbackSummaryQuery = z.infer<typeof FeedbackSummaryQuerySchema>;

/** The caller's own vote on one output. */
export interface MyFeedback {
  targetType: FeedbackTarget;
  targetId: string;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  note: string;
  updatedAt: string;
}

/** Votes per prompt version and model (back-office). */
export interface FeedbackPromptRow {
  type: AiJobType | null;
  promptKey: string | null;
  promptVersion: number | null;
  model: string | null;
  up: number;
  down: number;
}

export interface FeedbackSummary {
  days: number;
  total: number;
  up: number;
  down: number;
  /** `down / total`, or null with no votes. */
  downShare: number | null;
  byPrompt: FeedbackPromptRow[];
  /** 👎 per reason ("none" counts votes without one). */
  byReason: { reason: FeedbackReason | 'NONE'; count: number }[];
  /** The newest 👎 that came with a note. */
  recentNotes: {
    id: string;
    targetType: FeedbackTarget;
    targetId: string;
    topicId: string;
    reason: FeedbackReason | null;
    note: string;
    createdAt: string;
  }[];
}
