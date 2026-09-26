import { Inject, Injectable } from '@nestjs/common';
import { AiProviderName, parseModelRef, type AiProviderStatus } from '@contenter/shared';
import { ENV, type Env } from '../../../config/env';
import type { AiProvider } from './ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { MockProvider } from './mock.provider';
import { OpenAiProvider } from './openai.provider';

type LiveProvider = AiProvider & { readonly configured: boolean };

/**
 * All AI vendors Contenter can talk to. The model chosen in settings (`provider:model`)
 * decides which one runs a task; AI_PROVIDER=mock routes everything to MockProvider.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly live: Record<AiProviderName, LiveProvider>;
  private readonly mock = new MockProvider();
  readonly isMock: boolean;

  constructor(@Inject(ENV) env: Env) {
    this.isMock = env.AI_PROVIDER === 'mock';
    this.live = {
      anthropic: new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_REFUSAL_FALLBACK),
      openai: new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL),
    };
  }

  /** Provider + vendor model id for a stored model reference. */
  resolve(ref: string): { provider: AiProvider; model: string } {
    const { provider, model } = parseModelRef(ref);
    return { provider: this.isMock ? this.mock : this.live[provider], model };
  }

  status(): AiProviderStatus[] {
    return AiProviderName.map((name) => ({ name, configured: this.live[name].configured }));
  }
}
