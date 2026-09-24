import type { AiJob } from '@prisma/client';
import type { AiJobType } from '@contenter/shared';
import type { AiUsage } from '../provider/ai-provider';

export interface RunnerResult {
  /** Stored on AiJob.output — keep it small (ids + summary), domain data lives in domain tables. */
  output: Record<string, unknown>;
  model: string;
  usage: AiUsage;
  prompt: { key: string; version: number };
}

/**
 * One runner per AI task type. `run` reads inputs from the DB, calls the AI executor,
 * and persists validated results with plain code.
 */
export interface AiRunner {
  readonly type: AiJobType;
  run(job: AiJob): Promise<RunnerResult>;
  /** Called once when the job has definitively failed or was canceled. */
  onFailure?(job: AiJob, error: string): Promise<void>;
  /** Called when an admin re-queues a failed job. */
  onRetry?(job: AiJob): Promise<void>;
}

export const AI_RUNNERS = Symbol('AI_RUNNERS');
