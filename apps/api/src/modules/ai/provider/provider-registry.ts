import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AiProviderName, parseModelRef, type AiProviderStatus } from '@contenter/shared';
import { ENV, type Env } from '../../../config/env';
import { AiKeysService } from './ai-keys.service';
import { isEmbeddingProvider, type AiProvider, type EmbeddingProvider } from './ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { MockProvider } from './mock.provider';
import { OpenAiProvider } from './openai.provider';

type LiveProvider = AiProvider & {
  readonly configured: boolean;
  /** Live model list from the vendor, if it offers one. */
  listModels?(): Promise<string[] | undefined>;
  setApiKey(apiKey: string | undefined): void;
};

/** The API and the worker are separate processes, so a key saved in one reaches the other here. */
const KEY_REFRESH_MS = 15_000;

/**
 * All AI vendors Contenter can talk to. The model chosen in settings (`provider:model`)
 * decides which one runs a task; AI_PROVIDER=mock routes everything to MockProvider.
 * A key saved in the admin page wins over the environment variable.
 */
@Injectable()
export class AiProviderRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiProviderRegistry.name);
  private readonly live: Record<AiProviderName, LiveProvider>;
  private readonly mock = new MockProvider();
  readonly isMock: boolean;
  private readonly env: Env;
  private readonly saved: Partial<Record<AiProviderName, string>> = {};
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) env: Env,
    @Optional() private readonly keys?: AiKeysService,
  ) {
    this.env = env;
    this.isMock = env.AI_PROVIDER === 'mock';
    this.live = {
      anthropic: new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_REFUSAL_FALLBACK),
      openai: new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL),
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.keys) return;
    await this.refreshKeys();
    this.timer = setInterval(() => void this.refreshKeys(), KEY_REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-read the keys saved in the admin page and hand changed ones to the vendor clients. */
  async refreshKeys(): Promise<void> {
    if (!this.keys) return;
    try {
      const next = await this.keys.load();
      for (const name of AiProviderName) {
        if (next[name] === this.saved[name]) continue;
        this.live[name].setApiKey(next[name] ?? this.envKey(name));
        if (next[name]) this.saved[name] = next[name];
        else delete this.saved[name];
      }
    } catch (err) {
      // keep using what is loaded; a database blip must not stop AI jobs
      this.logger.warn(`Could not refresh AI keys: ${(err as Error).message}`);
    }
  }

  private envKey(name: AiProviderName): string | undefined {
    return name === 'anthropic' ? this.env.ANTHROPIC_API_KEY : this.env.OPENAI_API_KEY;
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
    await this.refreshKeys();
    return Promise.all(
      AiProviderName.map(async (name) => {
        const p = this.live[name];
        const models = p.configured ? await p.listModels?.() : undefined;
        const saved = this.saved[name];
        return {
          name,
          configured: p.configured,
          keySource: saved ? ('database' as const) : p.configured ? ('env' as const) : null,
          keyHint: saved ? saved.slice(-4) : null,
          ...(models ? { models } : {}),
        };
      }),
    );
  }
}
