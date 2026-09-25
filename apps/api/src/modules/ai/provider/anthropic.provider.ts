import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  NonRetryableAiError,
  type AiProvider,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider';

const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

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
      this.logger.warn(
        'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty — AI jobs will fail until it is set.',
      );
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!this.hasCredentials) {
      throw new NonRetryableAiError(
        'ANTHROPIC_API_KEY is not set. Add it to apps/api/.env (or set AI_PROVIDER=mock) and restart the API.',
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

    const u = message.usage;
    return {
      data: parsed.data,
      model: message.model,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
