import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import {
  isSourceBlocked,
  normalizeModelRef,
  type AiEffort,
  type AiJobType,
} from '@contenter/shared';
import { SettingsService } from '../settings/settings.module';
import { NO_BUSINESS } from './context';
import { AiAlertsService } from './ai-alerts.service';
import { AiBatchService } from './batch/ai-batch.service';
import { batchContext, JobDeferredError, type BatchContext } from './batch/batch-context';
import {
  isBatchProvider,
  isProviderDown,
  NonRetryableAiError,
  type AiUsage,
  type ResearchResult,
} from './provider/ai-provider';
import { AiProviderRegistry } from './provider/provider-registry';
import { PromptService } from './prompts/prompt.service';
import {
  blocklistNote,
  filterSources,
  searchToolBlocklist,
  type BlockRule,
} from './source-blocklist';
import type { PromptKey } from './prompts/defaults';
import { renderTemplate, templateVariables } from './prompts/render';

/**
 * Context blocks that must reach the model even when an admin-edited prompt version predates
 * them: if the template lacks the placeholder, the block is appended to the user message.
 */
const REQUIRED_BLOCKS: Record<string, { tag: string; empty: string }> = {
  business: { tag: 'business', empty: NO_BUSINESS },
  brand_docs: { tag: 'brand_guidelines', empty: '(none)' },
};

export function appendMissingBlocks(
  template: string,
  rendered: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  const used = new Set(templateVariables(template));
  const extra = Object.entries(REQUIRED_BLOCKS)
    .filter(([name, b]) => !used.has(name) && vars[name] != null && vars[name] !== b.empty)
    .map(([name, b]) => `<${b.tag}>\n${vars[name]}\n</${b.tag}>`);
  return extra.length ? `${extra.join('\n\n')}\n\n${rendered}` : rendered;
}

export interface ExecutionResult<T> {
  data: T;
  model: string;
  usage: AiUsage;
  prompt: { key: string; version: number };
  /** Set when the fallback model answered because the chosen model's vendor was unavailable. */
  fallbackFrom?: string;
}

/** Resolves prompt + model settings, renders variables and calls the model's provider. */
@Injectable()
export class AiExecutor {
  private readonly logger = new Logger(AiExecutor.name);

  constructor(
    private readonly providers: AiProviderRegistry,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
    private readonly alerts: AiAlertsService,
    private readonly batches: AiBatchService,
  ) {}

  /**
   * Runs `run` with the chosen model; when its vendor is unavailable (out of credit, key
   * refused, overloaded, unreachable) and a fallback model of a configured vendor is set in
   * Settings, runs it once with that instead and warns the admins. A request the model itself
   * rejects (bad output, refusal) is never retried elsewhere — another model would not fix it.
   */
  private async withFallback<R extends { model: string }>(
    ref: string,
    run: (ref: string) => Promise<R>,
  ): Promise<R & { fallbackFrom?: string }> {
    try {
      return await run(ref);
    } catch (err) {
      if (!isProviderDown(err)) throw err;
      const fallback = await this.settings.fallbackRef();
      if (!fallback || fallback === normalizeModelRef(ref) || !this.providers.isConfigured(fallback)) {
        throw err;
      }
      this.logger.warn(`${ref} is unavailable (${err.message}); using ${fallback}`);
      try {
        const result = await run(fallback);
        void this.alerts.send(
          `fallback:${normalizeModelRef(ref).split(':')[0]}`,
          'AI_FALLBACK_USED',
          `${normalizeModelRef(ref)} → ${fallback}: ${err.message}`,
        );
        return { ...result, fallbackFrom: ref };
      } catch (fallbackErr) {
        // the vendor problem is the news; a different failure of the fallback is worth showing
        throw isProviderDown(fallbackErr) ? err : fallbackErr;
      }
    }
  }

  async execute<T>(args: {
    task: AiJobType;
    promptKey: PromptKey;
    vars: Record<string, string | number | null | undefined>;
    schema: ZodType<T>;
    imageUrls?: string[];
  }): Promise<ExecutionResult<T>> {
    const prompt = await this.prompts.resolve(args.promptKey);
    const { model: ref, effort } = await this.settings.modelFor(args.task);
    const system = renderTemplate(prompt.system, args.vars);
    const user = appendMissingBlocks(prompt.user, renderTemplate(prompt.user, args.vars), args.vars);
    const ctx = batchContext.getStore();
    if (ctx) {
      // sizes of the prompts of this run, to learn characters per token (docs/66); images add
      // tokens the text does not explain
      ctx.promptChars = (ctx.promptChars ?? 0) + system.length + user.length;
      if (args.imageUrls?.length) ctx.unmeasured = true;
    }
    if (ctx?.economy) {
      const answered = await this.economy(ctx, args, { ref, effort, system, user });
      if (answered) return { ...answered, prompt: { key: prompt.key, version: prompt.version } };
    }
    const result = await this.withFallback(ref, (useRef) => {
      const { provider, model } = this.providers.resolve(useRef);
      return provider.generateStructured({
        task: args.task,
        model,
        effort,
        system,
        user,
        imageUrls: args.imageUrls,
        schema: args.schema,
      });
    });
    return { ...result, prompt: { key: prompt.key, version: prompt.version } };
  }

  /**
   * Economy mode (docs/60): the call goes to the vendor's batch API. The first run stores the
   * request and defers the job; the run after the batch answered finds the answer by position and
   * returns it as if it were live. A batch that failed lets this call (and the rest of the run)
   * go live at the normal price. Returns null when the call should run live.
   */
  private async economy<T>(
    ctx: BatchContext,
    args: { task: AiJobType; schema: ZodType<T>; imageUrls?: string[] },
    call: { ref: string; effort: AiEffort; system: string; user: string },
  ): Promise<Omit<ExecutionResult<T>, 'prompt'> | null> {
    const seq = ctx.seq++;
    const stored = await this.batches.find(ctx.jobId, seq);
    const ref = stored?.model ?? call.ref;
    const { provider, model } = this.providers.resolve(ref);
    if (!isBatchProvider(provider) || !this.providers.isConfigured(ref)) {
      ctx.economy = false;
      return null;
    }
    if (!stored) {
      const params = await provider.buildBatchParams({
        task: args.task,
        model,
        effort: call.effort,
        system: call.system,
        user: call.user,
        imageUrls: args.imageUrls,
        schema: args.schema,
      });
      await this.batches.create(ctx.jobId, seq, ref, params);
      throw new JobDeferredError();
    }
    if (stored.status === 'DONE') {
      const parsed = provider.parseBatchResult(stored.result, args.schema);
      return { ...parsed, usage: { ...parsed.usage, batch: true } };
    }
    if (stored.status === 'FAILED') {
      this.logger.warn(`batch call ${seq} of job ${ctx.jobId} failed (${stored.error}); running live`);
      ctx.economy = false;
      return null;
    }
    throw new JobDeferredError();
  }

  /**
   * Web research step (free-text notes + sources) with the task's model and effort. Blocked
   * sources are excluded from the vendor search where supported, named in the request, and
   * filtered out of the returned sources.
   */
  async research(args: {
    task: AiJobType;
    promptKey: PromptKey;
    vars: Record<string, string | number | null | undefined>;
    maxSearches: number;
    blocked?: BlockRule[];
    /** Limit the web search to these hosts (research scope REFERENCE_SITES). */
    allowedDomains?: string[];
  }): Promise<ResearchResult & { prompt: { key: string; version: number } }> {
    const blocked = args.blocked ?? [];
    // A blocked site never becomes searchable by being listed as a reference site.
    const allowedDomains = args.allowedDomains?.filter(
      (host) => !isSourceBlocked(`https://${host}`, blocked),
    );
    if (args.allowedDomains && !allowedDomains?.length) {
      // An empty allow-list would silently widen the search to the whole web.
      throw new NonRetryableAiError('No site is left to search: every reference site is blocked');
    }
    const note = blocklistNote(blocked);
    // search results add tokens the prompt text does not explain (docs/66)
    const store = batchContext.getStore();
    if (store) store.unmeasured = true;
    const prompt = await this.prompts.resolve(args.promptKey);
    const { model: ref, effort } = await this.settings.modelFor(args.task);
    const system = renderTemplate(prompt.system, args.vars);
    const user = [renderTemplate(prompt.user, args.vars), note].filter(Boolean).join('\n\n');
    const result = await this.withFallback(ref, (useRef) => {
      const { provider, model } = this.providers.resolve(useRef);
      return provider.research({
        task: args.task,
        model,
        effort,
        system,
        user,
        maxSearches: args.maxSearches,
        blockedDomains: searchToolBlocklist(blocked),
        allowedDomains,
      });
    });
    const onAllowedSite = (url: string) =>
      !allowedDomains ||
      isSourceBlocked(
        url,
        allowedDomains.map((value) => ({ kind: 'DOMAIN' as const, value })),
      );
    return {
      ...result,
      sources: filterSources(result.sources, blocked).filter((s) => onAllowedSite(s.url)),
      prompt: { key: prompt.key, version: prompt.version },
    };
  }
}
