import { Inject, Injectable } from '@nestjs/common';
import { AiProviderName, parseModelRef, type AiProviderStatus } from '@contenter/shared';
import { ENV, type Env } from '../../../config/env';
import { isEmbeddingProvider, type AiProvider, type EmbeddingProvider } from './ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { MockProvider } from './mock.provider';
import { OpenAiProvider } from './openai.provider';

type LiveProvider = AiProvider & {
  readonly configured: boolean;
  /** Live model list from the vendor, if it offers one. */
  listModels?(): Promise<string[] | undefined>;
};

/**
 * All AI vendors Contenter can talk to. The model chosen in settings (`provider:model`)
 * decides which one runs a task; AI_PROVIDER=mock routes everything to MockProvider.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly live: Record<AiProviderName, LiveProvider>;
  private readonly mock = new MockProvider();
  readonly isMock: boolean;
  private readonly env: Env;

  constructor(@Inject(ENV) env: Env) {
    this.env = env;
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

  /**
   * The embeddings vendor and model for semantic retrieval (docs/60), or null when it is off or
   * no configured vendor offers embeddings (then the whole text is shared equally, as before).
   */
  embedder(): { provider: AiProvider & EmbeddingProvider; model: string; ref: string } | null {
    if (this.env.SEMANTIC_RETRIEVAL === 'off') return null;
    const { provider: vendor, model } = parseModelRef(this.env.EMBEDDING_MODEL);
    const provider = this.isMock ? this.mock : this.live[vendor];
    if (!this.isMock && !this.live[vendor].configured) return null;
    return isEmbeddingProvider(provider) ? { provider, model, ref: `${vendor}:${model}` } : null;
  }

  /** True when the vendor of this model reference has credentials (always true in mock mode). */
  isConfigured(ref: string): boolean {
    if (this.isMock) return true;
    return this.live[parseModelRef(ref).provider].configured;
  }

  async status(): Promise<AiProviderStatus[]> {
    return Promise.all(
      AiProviderName.map(async (name) => {
        const p = this.live[name];
        const models = p.configured ? await p.listModels?.() : undefined;
        return { name, configured: p.configured, ...(models ? { models } : {}) };
      }),
    );
  }
}
