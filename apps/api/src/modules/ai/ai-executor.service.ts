import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import { isSourceBlocked, type AiJobType } from '@contenter/shared';
import { SettingsService } from '../settings/settings.module';
import { NO_BUSINESS } from './context';
import { NonRetryableAiError, type AiUsage, type ResearchResult } from './provider/ai-provider';
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
}

/** Resolves prompt + model settings, renders variables and calls the model's provider. */
@Injectable()
export class AiExecutor {
  constructor(
    private readonly providers: AiProviderRegistry,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
  ) {}

  async execute<T>(args: {
    task: AiJobType;
    promptKey: PromptKey;
    vars: Record<string, string | number | null | undefined>;
    schema: ZodType<T>;
    imageUrls?: string[];
  }): Promise<ExecutionResult<T>> {
    const prompt = await this.prompts.resolve(args.promptKey);
    const { model: ref, effort } = await this.settings.modelFor(args.task);
    const { provider, model } = this.providers.resolve(ref);
    const result = await provider.generateStructured({
      task: args.task,
      model,
      effort,
      system: renderTemplate(prompt.system, args.vars),
      user: appendMissingBlocks(prompt.user, renderTemplate(prompt.user, args.vars), args.vars),
      imageUrls: args.imageUrls,
      schema: args.schema,
    });
    return { ...result, prompt: { key: prompt.key, version: prompt.version } };
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
    const prompt = await this.prompts.resolve(args.promptKey);
    const { model: ref, effort } = await this.settings.modelFor(args.task);
    const { provider, model } = this.providers.resolve(ref);
    const result = await provider.research({
      task: args.task,
      model,
      effort,
      system: renderTemplate(prompt.system, args.vars),
      user: [renderTemplate(prompt.user, args.vars), note].filter(Boolean).join('\n\n'),
      maxSearches: args.maxSearches,
      blockedDomains: searchToolBlocklist(blocked),
      allowedDomains,
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
