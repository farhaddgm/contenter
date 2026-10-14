/**
 * Turns the vote counts into the back-office summary (docs/46-ai-feedback.md). Pure: the service
 * reads the rows, this does the arithmetic.
 */
import {
  type AiJobType,
  type FeedbackPromptRow,
  type FeedbackRating,
  type FeedbackReason,
  type FeedbackSummary,
} from '@contenter/shared';

export interface VoteCount {
  jobId: string | null;
  rating: FeedbackRating;
  count: number;
}

export interface JobInfo {
  id: string;
  type: AiJobType;
  promptKey: string | null;
  promptVersion: number | null;
  model: string | null;
}

export interface ReasonCount {
  reason: string | null;
  count: number;
}

const KNOWN_REASONS = new Set<string>([
  'WRONG_FACT',
  'TONE',
  'DUPLICATE',
  'TOO_LONG',
  'TOO_SHORT',
  'TRANSLATED_FEEL',
  'OFF_TOPIC',
  'OTHER',
]);

/**
 * Votes per prompt version and model, so a change of prompt can be judged by what people said.
 * Votes whose job is gone (or unknown) are counted together under no prompt.
 */
export function buildFeedbackSummary(args: {
  days: number;
  votes: VoteCount[];
  jobs: JobInfo[];
  reasons: ReasonCount[];
  recentNotes: FeedbackSummary['recentNotes'];
}): FeedbackSummary {
  const jobs = new Map(args.jobs.map((j) => [j.id, j]));
  const rows = new Map<string, FeedbackPromptRow>();
  let up = 0;
  let down = 0;
  for (const v of args.votes) {
    const job = v.jobId ? jobs.get(v.jobId) : undefined;
    const key = job ? `${job.promptKey}|${job.promptVersion}|${job.model}` : 'none';
    const row = rows.get(key) ?? {
      type: job?.type ?? null,
      promptKey: job?.promptKey ?? null,
      promptVersion: job?.promptVersion ?? null,
      model: job?.model ?? null,
      up: 0,
      down: 0,
    };
    if (v.rating === 'UP') {
      row.up += v.count;
      up += v.count;
    } else {
      row.down += v.count;
      down += v.count;
    }
    rows.set(key, row);
  }
  const reasonTotals = new Map<FeedbackReason | 'NONE', number>();
  for (const r of args.reasons) {
    const key = r.reason && KNOWN_REASONS.has(r.reason) ? (r.reason as FeedbackReason) : 'NONE';
    reasonTotals.set(key, (reasonTotals.get(key) ?? 0) + r.count);
  }
  const total = up + down;
  return {
    days: args.days,
    total,
    up,
    down,
    downShare: total ? down / total : null,
    byPrompt: [...rows.values()].sort((a, b) => b.down + b.up - (a.down + a.up) || b.down - a.down),
    byReason: [...reasonTotals.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    recentNotes: args.recentNotes,
  };
}
