import { describe, expect, it, vi } from 'vitest';
import { NonRetryableAiError, type ResearchRequest } from './ai-provider';
import { OpenAiProvider } from './openai.provider';

const req: ResearchRequest = {
  model: 'gpt-5.4',
  effort: 'high',
  system: 'sys',
  user: 'find facts',
  maxSearches: 5,
};

function response(over: Record<string, unknown>) {
  return {
    status: 'completed',
    incomplete_details: null,
    output_text: 'notes',
    output: [],
    model: 'gpt-5.4',
    usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
    ...over,
  };
}

/** A provider whose Responses API returns the given responses one call after another. */
function providerWith(...responses: unknown[]) {
  const stream = vi.fn(() => ({ finalResponse: async () => responses.shift() }));
  const provider = new OpenAiProvider('sk-test');
  (provider as unknown as { client: unknown }).client = { responses: { stream } };
  return { provider, stream };
}

const cutOff = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };

describe('OpenAiProvider.research output limit', () => {
  it('keeps partial notes instead of failing the build', async () => {
    const { provider, stream } = providerWith(response({ ...cutOff, output_text: 'partial notes' }));
    const result = await provider.research(req);
    expect(result.text).toBe('partial notes');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('retries once with low effort and a bigger budget when nothing was written', async () => {
    const { provider, stream } = providerWith(
      response({ ...cutOff, output_text: '' }),
      response({ output_text: 'second try' }),
    );
    const result = await provider.research(req);
    expect(result.text).toBe('second try');
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]![0]).toMatchObject({
      max_output_tokens: 64_000,
      reasoning: { effort: 'low' },
    });
  });

  it('still fails when even the retry writes nothing', async () => {
    const { provider } = providerWith(
      response({ ...cutOff, output_text: '' }),
      response({ ...cutOff, output_text: '' }),
    );
    await expect(provider.research(req)).rejects.toThrow(NonRetryableAiError);
  });

  it('does not retry other incomplete reasons', async () => {
    const { provider, stream } = providerWith(
      response({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
        output_text: '',
      }),
    );
    await expect(provider.research(req)).rejects.toThrow(/cut off \(content_filter\)/);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
