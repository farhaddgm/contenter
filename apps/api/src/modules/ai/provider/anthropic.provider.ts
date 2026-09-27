import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  mergeSources,
  NonRetryableAiError,
  sumUsage,
  type AiProvider,
  type AiUsage,
  type ResearchRequest,
  type ResearchResult,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider';

const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** A paused server-side search loop is resumed at most this many times. */
const MAX_CONTINUATIONS = 5;

/** Web search with dynamic filtering needs a 4.6+ model; older ones use the basic tool. */
export function webSearchToolType(model: string): 'web_search_20260209' | 'web_search_20250305' {
  return /haiku|claude-3|-4-5|-4-1|-4-0|-4-20|sonnet-4$|opus-4$/i.test(model)
    ? 'web_search_20250305'
    : 'web_search_20260209';
}

function usageOf(u: Anthropic.Beta.BetaUsage): AiUsage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearches: u.server_tool_use?.web_search_requests ?? 0,
  };
}

/**
 * Claude implementation of AiProvider.
 *
 * - Structured Outputs (`output_config.format`) constrain the response to the task schema;
 *   the result is re-validated with Zod before it is returned.
 * - Adaptive thinking + per-task `effort`.
 * - Streaming, so long generations never hit HTTP timeouts.
 * - The stable system prompt is cached.
 * - Optional server-side refusal fallback.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  private readonly hasCredentials: boolean;

  get configured(): boolean {
    return this.hasCredentials;
  }

  constructor(
    apiKey: string | undefined,
    private readonly refusalFallback: boolean,
  ) {
    this.hasCredentials = !!(
      apiKey ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN
    );
    this.client = new Anthropic(apiKey ? { apiKey } : {});
    if (!this.hasCredentials) {
      this.logger.log(
        'ANTHROPIC_API_KEY is empty — Claude models are unavailable until it is set.',
      );
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!this.hasCredentials) {
      throw new NonRetryableAiError(
        'ANTHROPIC_API_KEY is not set. Add it to apps/api/.env and restart the API, or pick a model from another provider in Settings.',
      );
    }
    try {
      return await this.call(req, req.imageUrls ?? []);
    } catch (err) {
      // A sample image URL the API cannot download should not sink the whole analysis.
      if (err instanceof Anthropic.BadRequestError && req.imageUrls?.length) {
        this.logger.warn(`Retrying ${req.task} without images: ${err.message}`);
        return this.call(req, []);
      }
      if (
        err instanceof Anthropic.BadRequestError ||
        err instanceof Anthropic.AuthenticationError
      ) {
        throw new NonRetryableAiError(err.message);
      }
      throw err;
    }
  }

  private async call<T>(
    req: StructuredRequest<T>,
    imageUrls: string[],
  ): Promise<StructuredResult<T>> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...imageUrls.map((url): Anthropic.Beta.BetaImageBlockParam => ({
        type: 'image',
        source: { type: 'url', url },
      })),
      { type: 'text', text: req.user },
    ];

    const params = {
      model: req.model,
      max_tokens: req.maxTokens ?? 32_000,
      thinking: { type: 'adaptive' as const },
      output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      system: [
        { type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' as const } },
      ],
      messages: [{ role: 'user' as const, content }],
      ...(this.refusalFallback ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' } : {}),
    };

    const message = await this.client.beta.messages
      .stream(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming)
      .finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new NonRetryableAiError(
        `Model declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`,
      );
    }
    if (message.stop_reason === 'max_tokens') {
      throw new NonRetryableAiError('Output was truncated (max_tokens reached)');
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new NonRetryableAiError('Model returned invalid JSON');
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) {
      throw new NonRetryableAiError(`Model output failed validation: ${parsed.error.message}`);
    }

    return { data: parsed.data, model: message.model, usage: usageOf(message.usage) };
  }

  /**
   * Web research with Claude's server-side web search tool. The search loop runs on
   * Anthropic's side; a `pause_turn` is resumed by sending the partial assistant turn back.
   */
  async research(req: ResearchRequest): Promise<ResearchResult> {
    if (!this.hasCredentials) {
      throw new NonRetryableAiError(
        'ANTHROPIC_API_KEY is not set. Add it to apps/api/.env and restart the API, or pick a model from another provider in Settings.',
      );
    }
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: req.user }] },
    ];
    const blocks: Anthropic.Beta.BetaContentBlock[] = [];
    const usages: AiUsage[] = [];
    let model = req.model;

    try {
      for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        const params = {
          model: req.model,
          max_tokens: req.maxTokens ?? 32_000,
          thinking: { type: 'adaptive' as const },
          output_config: { effort: req.effort },
          system: [
            {
              type: 'text' as const,
              text: req.system,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
          tools: [
            { type: webSearchToolType(req.model), name: 'web_search', max_uses: req.maxSearches },
          ],
          messages,
          ...(this.refusalFallback ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' } : {}),
        };
        const message = await this.client.beta.messages
          .stream(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming)
          .finalMessage();
        model = message.model;
        usages.push(usageOf(message.usage));
        blocks.push(...message.content);

        if (message.stop_reason === 'refusal') {
          throw new NonRetryableAiError(
            `Model declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`,
          );
        }
        if (message.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: message.content });
      }
    } catch (err) {
      if (
        err instanceof Anthropic.BadRequestError ||
        err instanceof Anthropic.AuthenticationError
      ) {
        throw new NonRetryableAiError(err.message);
      }
      throw err;
    }

    const { text, sources } = collectResearch(blocks);
    if (!text.trim()) throw new NonRetryableAiError('Web research returned no findings');
    return { text, sources, model, usage: sumUsage(...usages) };
  }
}

/**
 * Final notes = text written after the last search result (earlier text is narration such as
 * "let me search…"); sources = every search result plus every cited page.
 */
export function collectResearch(blocks: Anthropic.Beta.BetaContentBlock[]): {
  text: string;
  sources: { url: string; title: string }[];
} {
  const results: { url: string; title: string }[] = [];
  const cited: { url: string; title: string }[] = [];
  let lastResult = -1;
  blocks.forEach((b, i) => {
    if (b.type === 'web_search_tool_result') {
      lastResult = i;
      if (Array.isArray(b.content)) {
        for (const r of b.content) results.push({ url: r.url, title: r.title });
      }
    }
    if (b.type === 'text') {
      for (const c of b.citations ?? []) {
        if (c.type === 'web_search_result_location')
          cited.push({ url: c.url, title: c.title ?? '' });
      }
    }
  });
  const textOf = (from: number) =>
    blocks
      .slice(from)
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  const text = textOf(lastResult + 1) || textOf(0);
  return { text, sources: mergeSources(cited, results) };
}
