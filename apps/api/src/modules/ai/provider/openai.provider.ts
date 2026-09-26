import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';
import {
  NonRetryableAiError,
  type AiProvider,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider';

type OpenAiEffort = NonNullable<OpenAI.Reasoning['effort']>;

/** Reasoning models accept `reasoning.effort`; older chat models reject it. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model) && !/-chat(-latest)?$/i.test(model);
}

/**
 * OpenAI implementation of AiProvider (Responses API).
 *
 * - Structured Outputs (`text.format` json_schema, strict) built from the task's Zod schema;
 *   the result is re-validated with Zod before it is returned.
 * - Contenter effort → `reasoning.effort` on reasoning models (clamped if a model rejects it).
 * - Streaming, so long generations never hit HTTP timeouts. Nothing is stored at OpenAI.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI | null;

  constructor(apiKey: string | undefined, baseURL?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    this.client = key ? new OpenAI({ apiKey: key, baseURL, maxRetries: 2 }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!this.client) {
      throw new NonRetryableAiError(
        'OPENAI_API_KEY is not set. Add it to apps/api/.env and restart the API, or pick a model from another provider in Settings.',
      );
    }
    // Contenter's effort levels share OpenAI's names.
    const effort: OpenAiEffort = req.effort;
    try {
      return await this.call(this.client, req, req.imageUrls ?? [], effort);
    } catch (err) {
      if (!(err instanceof OpenAI.APIError)) throw err;
      if (err instanceof OpenAI.BadRequestError) {
        // Not every model supports the highest effort levels.
        if ((effort === 'xhigh' || effort === 'max') && /reasoning|effort/i.test(err.message)) {
          this.logger.warn(`${req.model} rejected effort "${effort}", retrying with "high"`);
          return this.call(this.client, req, req.imageUrls ?? [], 'high');
        }
        // A sample image URL the API cannot download should not sink the whole analysis.
        if (req.imageUrls?.length && /image/i.test(err.message)) {
          this.logger.warn(`Retrying ${req.task} without images: ${err.message}`);
          return this.call(this.client, req, [], effort);
        }
      }
      if (
        err instanceof OpenAI.BadRequestError ||
        err instanceof OpenAI.AuthenticationError ||
        err instanceof OpenAI.PermissionDeniedError ||
        err instanceof OpenAI.NotFoundError ||
        (err instanceof OpenAI.RateLimitError && err.code === 'insufficient_quota')
      ) {
        throw new NonRetryableAiError(`OpenAI: ${err.message}`);
      }
      throw err;
    }
  }

  private async call<T>(
    client: OpenAI,
    req: StructuredRequest<T>,
    imageUrls: string[],
    effort: OpenAiEffort,
  ): Promise<StructuredResult<T>> {
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      stream: true,
      model: req.model,
      instructions: req.system,
      input: [
        {
          role: 'user',
          content: [
            ...imageUrls.map((url): OpenAI.Responses.ResponseInputImage => ({
              type: 'input_image',
              image_url: url,
              detail: 'auto',
            })),
            { type: 'input_text', text: req.user },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: `${req.task.toLowerCase()}_result`,
          schema: toStrictJsonSchema(req.schema),
          strict: true,
        },
      },
      max_output_tokens: req.maxTokens ?? 32_000,
      store: false,
      ...(isReasoningModel(req.model) ? { reasoning: { effort } } : {}),
    };

    const response = await client.responses.stream(params).finalResponse();

    const refusal = response.output
      .flatMap((item) => (item.type === 'message' ? item.content : []))
      .find((c) => c.type === 'refusal');
    if (refusal && refusal.type === 'refusal') {
      throw new NonRetryableAiError(`Model declined the request: ${refusal.refusal}`);
    }
    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason;
      throw new NonRetryableAiError(
        reason === 'max_output_tokens'
          ? 'Output was truncated (max_tokens reached)'
          : `Model declined the request (${reason ?? 'incomplete'})`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(response.output_text);
    } catch {
      throw new NonRetryableAiError('Model returned invalid JSON');
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) {
      throw new NonRetryableAiError(`Model output failed validation: ${parsed.error.message}`);
    }

    const u = response.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    return {
      data: parsed.data,
      model: response.model,
      usage: {
        // OpenAI counts cached tokens inside input_tokens; keep the buckets disjoint.
        inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cached),
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}

/**
 * JSON Schema for strict Structured Outputs: every object closed and fully required.
 * Task schemas in packages/shared/src/ai.ts already follow these rules.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return closeObjects(json) as Record<string, unknown>;
}

function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = closeObjects(v);
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}
