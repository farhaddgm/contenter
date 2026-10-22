import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * State of one run of an economy-mode job (docs/60-reliability-and-cost.md).
 *
 * A runner calls the model through `AiExecutor.execute`. In economy mode that call does not
 * answer at once: the request is stored and sent to the vendor's batch API, and the run stops
 * with `JobDeferredError`. When the batch is done the job runs again from the start; each model
 * call is matched to its stored answer by its position (`seq`), so earlier calls are replayed
 * from the database at no cost and the first unanswered one defers again.
 */
export interface BatchContext {
  jobId: string;
  /** Switched off for the rest of the run when a batch did not deliver and the call ran live. */
  economy: boolean;
  /** Position of the next model call of this run. */
  seq: number;
  /**
   * Characters of the prompts (system + user) this run rendered, summed over its model calls
   * (docs/66). Read by `AiJobsService` once the run succeeds.
   */
  promptChars?: number;
  /** Set when a call's size cannot be compared with its tokens (web research, images). */
  unmeasured?: boolean;
}

export const batchContext = new AsyncLocalStorage<BatchContext>();

/** Thrown inside a run to say "this job waits for its batch result"; not a failure. */
export class JobDeferredError extends Error {
  constructor() {
    super('The job waits for its batch result');
    this.name = 'JobDeferredError';
  }
}
