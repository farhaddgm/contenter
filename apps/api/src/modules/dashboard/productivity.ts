/**
 * Builds the productivity numbers from plain rows (docs/44-productivity-dashboard.md). Pure: the
 * service reads the rows, this turns them into numbers, so the arithmetic is easy to test.
 */
import {
  MIN_PRODUCTIVITY_SAMPLES,
  type AiJobType,
  type DurationStats,
  type JobTypeProductivity,
  type ProductivityStats,
} from '@contenter/shared';

const HOUR = 3_600_000;

/** One content approved in the period. */
export interface ApprovedRow {
  createdAt: Date;
  /** Decision times of its SUBMITTED and APPROVED review steps. */
  reviews: { decision: 'SUBMITTED' | 'APPROVED'; createdAt: Date }[];
  /** The approved text is a version an editor wrote. */
  editedByHuman: boolean;
}

export interface JobTypeRow {
  type: AiJobType;
  total: number;
  failed: number;
  retried: number;
  costUsd: number;
}

/** The p-th percentile (0–1) by the nearest-rank method; null for an empty list. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function durationStats(hours: number[]): DurationStats {
  const sorted = [...hours].sort((a, b) => a - b);
  const enough = sorted.length >= MIN_PRODUCTIVITY_SAMPLES;
  return {
    samples: sorted.length,
    medianHours: enough ? round1(percentile(sorted, 0.5)!) : null,
    p90Hours: enough ? round1(percentile(sorted, 0.9)!) : null,
  };
}

/**
 * When the content was approved: its last APPROVED step. A content approved, reopened and approved
 * again counts from the latest approval, and a decision after `until` is not part of the period.
 */
export function approvalOf(
  row: ApprovedRow,
): { approvedAt: Date; submittedAt: Date | null } | null {
  const approvals = row.reviews.filter((r) => r.decision === 'APPROVED');
  const last = approvals.reduce<Date | null>(
    (acc, r) => (!acc || r.createdAt > acc ? r.createdAt : acc),
    null,
  );
  if (!last) return null;
  // the review the approval ended: the latest submit before it
  const submitted = row.reviews
    .filter((r) => r.decision === 'SUBMITTED' && r.createdAt <= last)
    .reduce<Date | null>((acc, r) => (!acc || r.createdAt > acc ? r.createdAt : acc), null);
  return { approvedAt: last, submittedAt: submitted };
}

export function buildProductivity(args: {
  days: number;
  since: Date;
  contents: ApprovedRow[];
  jobs: JobTypeRow[];
}): ProductivityStats {
  const cycle: number[] = [];
  const review: number[] = [];
  let approved = 0;
  let edited = 0;
  for (const row of args.contents) {
    const a = approvalOf(row);
    if (!a || a.approvedAt < args.since) continue; // approved before the period
    approved++;
    if (row.editedByHuman) edited++;
    cycle.push(Math.max(0, (a.approvedAt.getTime() - row.createdAt.getTime()) / HOUR));
    if (a.submittedAt)
      review.push(Math.max(0, (a.approvedAt.getTime() - a.submittedAt.getTime()) / HOUR));
  }
  const enough = approved >= MIN_PRODUCTIVITY_SAMPLES;
  const totalUsd = args.jobs.reduce((s, j) => s + j.costUsd, 0);
  const byJobType: JobTypeProductivity[] = [...args.jobs].sort((a, b) => b.costUsd - a.costUsd);
  return {
    days: args.days,
    since: args.since.toISOString(),
    approved,
    edited,
    unedited: approved - edited,
    uneditedShare: enough ? (approved - edited) / approved : null,
    cycle: durationStats(cycle),
    review: durationStats(review),
    cost: {
      totalUsd,
      jobs: args.jobs.reduce((s, j) => s + j.total, 0),
      failedJobs: args.jobs.reduce((s, j) => s + j.failed, 0),
      perApprovedUsd: enough ? totalUsd / approved : null,
    },
    byJobType,
  };
}
