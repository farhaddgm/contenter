/**
 * The productivity numbers of the dashboard (docs/44-productivity-dashboard.md): how good the
 * drafts are, how long the way to approval takes and what the AI costs per approved content.
 * Everything is counted by code from rows that already exist; no AI, no new columns.
 */
import { z } from 'zod';
import type { AiJobType } from './enums';

export const PRODUCTIVITY_PERIODS = [7, 30, 90] as const;
export type ProductivityPeriod = (typeof PRODUCTIVITY_PERIODS)[number];

/** Below this many contents a median or a share is noise, so it is not shown. */
export const MIN_PRODUCTIVITY_SAMPLES = 5;

export const ProductivityQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d): d is ProductivityPeriod => (PRODUCTIVITY_PERIODS as readonly number[]).includes(d))
    .default(30),
  topicId: z.string().min(1).max(40).optional(),
  businessId: z.string().min(1).max(40).optional(),
});
export type ProductivityQuery = z.infer<typeof ProductivityQuerySchema>;

/** A typical value and the slow end of a list of durations, in hours. */
export interface DurationStats {
  /** Contents the numbers are from. */
  samples: number;
  /** null below MIN_PRODUCTIVITY_SAMPLES. */
  medianHours: number | null;
  p90Hours: number | null;
}

export interface JobTypeProductivity {
  type: AiJobType;
  total: number;
  failed: number;
  /** Jobs that needed more than one attempt. */
  retried: number;
  costUsd: number;
}

export interface ProductivityStats {
  days: number;
  /** Start of the period (ISO). */
  since: string;
  /** Contents approved in the period. */
  approved: number;
  /** Of those, the ones an editor changed before approval / approved as the AI wrote them. */
  edited: number;
  unedited: number;
  /** `unedited / approved`; null below MIN_PRODUCTIVITY_SAMPLES. */
  uneditedShare: number | null;
  /** From the draft's creation to its approval. */
  cycle: DurationStats;
  /** From the last submit for review to the approval. */
  review: DurationStats;
  cost: {
    totalUsd: number;
    jobs: number;
    failedJobs: number;
    /** `totalUsd / approved`; null below MIN_PRODUCTIVITY_SAMPLES. */
    perApprovedUsd: number | null;
  };
  byJobType: JobTypeProductivity[];
}
