import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { AiJobType } from '@contenter/shared';
import { SettingsService } from '../settings/settings.module';
import type { AiUsage } from './provider/ai-provider';
import { AiProviderRegistry } from './provider/provider-registry';
import { PromptService } from './prompts/prompt.service';
import type { PromptKey } from './prompts/defaults';
import { renderTemplate } from './prompts/render';

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
      user: renderTemplate(prompt.user, args.vars),
      imageUrls: args.imageUrls,
      schema: args.schema,
    });
    return { ...result, prompt: { key: prompt.key, version: prompt.version } };
  }
}
