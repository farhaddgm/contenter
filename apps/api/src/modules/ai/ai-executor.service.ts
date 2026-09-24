import { Inject, Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { AiJobType } from '@contenter/shared';
import { SettingsService } from '../settings/settings.module';
import { AI_PROVIDER, type AiProvider, type AiUsage } from './provider/ai-provider';
import { PromptService } from './prompts/prompt.service';
import type { PromptKey } from './prompts/defaults';
import { renderTemplate } from './prompts/render';

export interface ExecutionResult<T> {
  data: T;
  model: string;
  usage: AiUsage;
  prompt: { key: string; version: number };
}

/** Resolves prompt + model settings, renders variables and calls the provider. */
@Injectable()
export class AiExecutor {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
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
    const { model, effort } = await this.settings.modelFor(args.task);
    const result = await this.provider.generateStructured({
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
