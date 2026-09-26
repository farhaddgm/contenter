/**
 * AI vendors and the model catalog shown in the back office.
 *
 * A model is stored in settings as a reference `"<provider>:<model>"`, e.g. `openai:gpt-5.4`.
 * Bare ids (legacy settings, AI_DEFAULT_MODEL) are resolved by their prefix.
 */
export const AiProviderName = ['anthropic', 'openai'] as const;
export type AiProviderName = (typeof AiProviderName)[number];

export interface AiModelInfo {
  provider: AiProviderName;
  id: string;
}

/** Suggested models; admins may also type any other id the vendor supports. */
export const AI_MODEL_CATALOG: readonly AiModelInfo[] = [
  { provider: 'anthropic', id: 'claude-opus-5' },
  { provider: 'anthropic', id: 'claude-opus-5-5' },
  { provider: 'anthropic', id: 'claude-fable-5-1' },
  { provider: 'anthropic', id: 'claude-sonnet-5' },
  { provider: 'anthropic', id: 'claude-haiku-4-5' },
  { provider: 'openai', id: 'gpt-5.4' },
  { provider: 'openai', id: 'gpt-5.4-mini' },
  { provider: 'openai', id: 'gpt-5.4-nano' },
  { provider: 'openai', id: 'gpt-5.2' },
  { provider: 'openai', id: 'gpt-5.1' },
  { provider: 'openai', id: 'gpt-5' },
  { provider: 'openai', id: 'gpt-5-mini' },
  { provider: 'openai', id: 'gpt-5-nano' },
  { provider: 'openai', id: 'gpt-4.1' },
  { provider: 'openai', id: 'gpt-4.1-mini' },
  { provider: 'openai', id: 'o4-mini' },
];

/** `provider:model` or a bare model id. */
export const MODEL_REF_PATTERN = /^([a-z][a-z0-9-]*:)?[A-Za-z0-9][\w.\-/]*$/;

export function modelRef(provider: AiProviderName, model: string): string {
  return `${provider}:${model}`;
}

export function inferProvider(model: string): AiProviderName {
  return /^(gpt-|o\d|chatgpt-|codex-)/i.test(model) ? 'openai' : 'anthropic';
}

export function parseModelRef(ref: string): { provider: AiProviderName; model: string } {
  const i = ref.indexOf(':');
  if (i > 0) {
    const provider = ref.slice(0, i) as AiProviderName;
    if ((AiProviderName as readonly string[]).includes(provider)) {
      return { provider, model: ref.slice(i + 1) };
    }
  }
  return { provider: inferProvider(ref), model: ref };
}

/** Canonical `provider:model` form of any stored reference. */
export function normalizeModelRef(ref: string): string {
  const { provider, model } = parseModelRef(ref);
  return modelRef(provider, model);
}
