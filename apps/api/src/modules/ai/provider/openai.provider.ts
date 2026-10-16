import { Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import {
  researchSources,
  NonRetryableAiError,
  ProviderOverloadedError,
  ProviderUnavailableError,
  type AiProvider,
  type AiUsage,
  type BatchItemResult,
  type BatchPoll,
  type BatchProvider,
  type EmbeddingProvider,
  type ResearchRequest,
  type ResearchResult,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider';

type OpenAiEffort = NonNullable<OpenAI.Reasoning['effort']>;

/** Reasoning models accept `reasoning.effort`; older chat models reject it. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-([5-9]|\d{2,})|o\d)/i.test(model) && !/-chat(-latest)?$/i.test(model);
}

/** Ids from `GET /v1/models` that can run Contenter's text tasks (no audio/image/embedding…). */
export function isTextModel(id: string): boolean {
  return (
    /^(gpt-\d|o\d|chatgpt-)/i.test(id) &&
    !/(audio|realtime|tts|transcribe|image|embedding|instruct|moderation|search|codex)/i.test(id) &&
    !/-\d{4}-\d{2}-\d{2}$/.test(id)
  );
}

const MODELS_TTL_MS = 60 * 60 * 1000;

/**
 * OpenAI implementation of AiProvider (Responses API).
 *
 * - Structured Outputs (`text.format` json_schema, strict) built from the task's Zod schema;
 *   the result is re-validated with Zod before it is returned.
 * - Contenter effort → `reasoning.effort` on reasoning models (clamped if a model rejects it).
 * - Streaming, so long generations never hit HTTP timeouts. Nothing is stored at OpenAI.
 */
export class OpenAiProvider implements AiProvider, BatchProvider, EmbeddingProvider {
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

  private modelsCache: { at: number; ids: string[] } | null = null;

  /**
   * Text models the account can use, straight from the API, so new releases show up in
   * Settings without a code change. Cached for an hour; `undefined` if the list can't be read.
   */
  async listModels(): Promise<string[] | undefined> {
    if (!this.client) return undefined;
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) {
      return this.modelsCache.ids;
    }
    try {
      const ids: string[] = [];
      for await (const m of this.client.models.list({ timeout: 10_000, maxRetries: 0 })) {
        if (isTextModel(m.id)) ids.push(m.id);
      }
      ids.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      this.modelsCache = { at: Date.now(), ids };
      return ids;
    } catch (err) {
      this.logger.warn(`Could not list OpenAI models: ${(err as Error).message}`);
      return this.modelsCache?.ids;
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!this.client) {
      throw new ProviderUnavailableError(
        'OPENAI_API_KEY is not set. Add it to apps/api/.env and restart the API, or pick a model from another provider in Settings.',
        'auth',
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
      throw permanentOrRaw(err);
    }
  }

  /**
   * Web research with the Responses API `web_search` tool (runs on OpenAI's side). The tool only
   * supports an allow-list, so blocked sources rely on the request note and the source filter.
   */
  async research(req: ResearchRequest): Promise<ResearchResult> {
    if (!this.client) {
      throw new ProviderUnavailableError(
        'OPENAI_API_KEY is not set. Add it to apps/api/.env and restart the API, or pick a model from another provider in Settings.',
        'auth',
      );
    }
    const effort: OpenAiEffort =
      req.effort === 'xhigh' || req.effort === 'max' ? 'high' : req.effort;
    const maxTokens = req.maxTokens ?? 32_000;
    let response = await this.researchOnce(this.client, req, effort, maxTokens);
    // Reasoning tokens share the output budget with the notes, so a deep search can use it all up
    // before writing a word. Partial notes are still useful research; with none, retry once with
    // less thinking and more room instead of failing the whole build.
    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
      if (response.output_text.trim()) {
        this.logger.warn(`Research hit the output limit; keeping the partial notes (${req.model})`);
      } else {
        this.logger.warn(`Research hit the output limit with no notes; retrying with "low" effort`);
        response = await this.researchOnce(this.client, req, 'low', maxTokens * 2);
      }
    }
    if (response.status === 'incomplete' && !response.output_text.trim()) {
      throw new NonRetryableAiError(
        `Research was cut off (${response.incomplete_details?.reason ?? 'incomplete'})`,
      );
    }

    const cited: { url: string; title: string }[] = [];
    const found: { url: string; title: string }[] = [];
    let searches = 0;
    for (const item of response.output) {
      if (item.type === 'web_search_call') {
        searches++;
        if (item.action.type === 'search') {
          for (const s of item.action.sources ?? []) found.push({ url: s.url, title: s.url });
        }
      }
      if (item.type === 'message') {
        for (const c of item.content) {
          if (c.type !== 'output_text') continue;
          for (const a of c.annotations) {
            if (a.type === 'url_citation') cited.push({ url: a.url, title: a.title });
          }
        }
      }
    }
    const text = response.output_text.trim();
    if (!text) throw new NonRetryableAiError('Web research returned no findings');

    const u = response.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    return {
      text,
      sources: researchSources(cited, found, text),
      model: response.model,
      usage: {
        inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cached),
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        webSearches: searches,
      },
    };
  }

  private async researchOnce(
    client: OpenAI,
    req: ResearchRequest,
    effort: OpenAiEffort,
    maxTokens: number,
  ): Promise<OpenAI.Responses.Response> {
    try {
      return await client.responses
        .stream({
          stream: true,
          model: req.model,
          instructions: req.system,
          input: [{ role: 'user', content: [{ type: 'input_text', text: req.user }] }],
          tools: [
            {
              type: 'web_search',
              search_context_size: 'high',
              ...(req.allowedDomains?.length
                ? { filters: { allowed_domains: req.allowedDomains } }
                : {}),
            },
          ],
          include: ['web_search_call.action.sources'],
          max_tool_calls: req.maxSearches,
          max_output_tokens: maxTokens,
          store: false,
          ...(isReasoningModel(req.model) ? { reasoning: { effort } } : {}),
        })
        .finalResponse();
    } catch (err) {
      throw permanentOrRaw(err);
    }
  }

  /** The Responses API request of a structured call, without the transport (`stream`). */
  private structuredBody<T>(
    req: StructuredRequest<T>,
    imageUrls: string[],
    effort: OpenAiEffort,
  ): Omit<OpenAI.Responses.ResponseCreateParamsStreaming, 'stream'> {
    return {
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
  }

  private async call<T>(
    client: OpenAI,
    req: StructuredRequest<T>,
    imageUrls: string[],
    effort: OpenAiEffort,
  ): Promise<StructuredResult<T>> {
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      ...this.structuredBody(req, imageUrls, effort),
      stream: true,
    };
    const response = await client.responses.stream(params).finalResponse();
    return finishStructured(response, req.schema);
  }

  /** Embeddings of texts, in request order, at most 256 per call. */
  async embed(
    texts: string[],
    model: string,
  ): Promise<{ vectors: number[][]; usage: AiUsage }> {
    if (!this.client) {
      throw new ProviderUnavailableError('OPENAI_API_KEY is not set.', 'auth');
    }
    const vectors: number[][] = [];
    let tokens = 0;
    try {
      for (let i = 0; i < texts.length; i += 256) {
        const res = await this.client.embeddings.create({
          model,
          input: texts.slice(i, i + 256),
          encoding_format: 'float',
        });
        for (const d of [...res.data].sort((a, b) => a.index - b.index)) vectors.push(d.embedding);
        tokens += res.usage?.prompt_tokens ?? 0;
      }
    } catch (err) {
      throw permanentOrRaw(err);
    }
    return {
      vectors,
      usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }

  // ───────────── batch mode (docs/60) ─────────────

  async buildBatchParams(req: StructuredRequest<unknown>): Promise<Record<string, unknown>> {
    return this.structuredBody(req, req.imageUrls ?? [], req.effort) as Record<string, unknown>;
  }

  /** One JSONL file of requests, one batch; results arrive within 24 hours at half the price. */
  async submitBatch(
    items: { customId: string; params: Record<string, unknown> }[],
  ): Promise<{ batchRef: string }> {
    if (!this.client) {
      throw new ProviderUnavailableError('OPENAI_API_KEY is not set.', 'auth');
    }
    try {
      const jsonl = items
        .map((i) =>
          JSON.stringify({
            custom_id: i.customId,
            method: 'POST',
            url: '/v1/responses',
            body: i.params,
          }),
        )
        .join('\n');
      const file = await this.client.files.create({
        file: await toFile(Buffer.from(jsonl, 'utf8'), 'contenter-batch.jsonl'),
        purpose: 'batch',
      });
      const batch = await this.client.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/responses',
        completion_window: '24h',
      });
      return { batchRef: batch.id };
    } catch (err) {
      throw permanentOrRaw(err);
    }
  }

  async pollBatch(batchRef: string): Promise<BatchPoll> {
    if (!this.client) {
      throw new ProviderUnavailableError('OPENAI_API_KEY is not set.', 'auth');
    }
    try {
      const b = await this.client.batches.retrieve(batchRef);
      if (['validating', 'in_progress', 'finalizing', 'cancelling'].includes(b.status)) {
        return { state: 'running' };
      }
      if (!b.output_file_id && !b.error_file_id) {
        return {
          state: 'failed',
          error: b.errors?.data?.[0]?.message ?? `The batch ended as "${b.status}" without results`,
        };
      }
      const results: Record<string, BatchItemResult> = {};
      for (const fileId of [b.output_file_id, b.error_file_id]) {
        if (!fileId) continue;
        const text = await (await this.client.files.content(fileId)).text();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const row = JSON.parse(line) as {
            custom_id: string;
            response?: { status_code: number; body: unknown };
            error?: { message?: string } | null;
          };
          if (row.response && row.response.status_code === 200) {
            results[row.custom_id] = { ok: true, raw: row.response.body };
          } else {
            const body = row.response?.body as { error?: { message?: string } } | undefined;
            results[row.custom_id] = {
              ok: false,
              error: row.error?.message ?? body?.error?.message ?? `HTTP ${row.response?.status_code}`,
            };
          }
        }
      }
      return { state: 'done', results };
    } catch (err) {
      throw permanentOrRaw(err);
    }
  }

  parseBatchResult<T>(raw: unknown, schema: z.ZodType<T>): StructuredResult<T> {
    return finishStructured(raw as ResponseLike, schema);
  }
}

/** What `finishStructured` needs of a response; also satisfied by a batch's raw JSON body. */
type ResponseLike = Pick<
  OpenAI.Responses.Response,
  'output' | 'status' | 'incomplete_details' | 'usage' | 'model'
> & { output_text?: string };

/** The model's text: the SDK helper when present, else the `output_text` parts of the messages. */
function outputTextOf(response: ResponseLike): string {
  if (typeof response.output_text === 'string') return response.output_text;
  return response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .map((c) => (c.type === 'output_text' ? c.text : ''))
    .join('');
}

/** Refusal / truncation checks, JSON parse, Zod validation and usage of one structured answer. */
function finishStructured<T>(response: ResponseLike, schema: z.ZodType<T>): StructuredResult<T> {
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
    json = JSON.parse(outputTextOf(response));
  } catch {
    throw new NonRetryableAiError('Model returned invalid JSON');
  }
  const parsed = schema.safeParse(json);
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

/** Failures that retrying will not fix become NonRetryableAiError; others are rethrown. */
export function permanentOrRaw(err: unknown): unknown {
  if (err instanceof OpenAI.RateLimitError && err.code === 'insufficient_quota') {
    return new ProviderUnavailableError(`OpenAI: ${err.message}`, 'quota');
  }
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new ProviderUnavailableError(`OpenAI: ${err.message}`, 'auth');
  }
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.NotFoundError) {
    return new NonRetryableAiError(`OpenAI: ${err.message}`);
  }
  // 429 without insufficient_quota, 5xx, dropped connections and timeouts: the SDK already
  // retried; the queue retries again and the executor may switch to the fallback model.
  if (
    err instanceof OpenAI.RateLimitError ||
    err instanceof OpenAI.InternalServerError ||
    err instanceof OpenAI.APIConnectionError
  ) {
    return new ProviderOverloadedError(
      `OpenAI: ${err.message}`,
      err instanceof OpenAI.APIConnectionError ? 'network' : 'overloaded',
    );
  }
  return err;
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
