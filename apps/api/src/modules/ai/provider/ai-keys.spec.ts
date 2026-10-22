import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import { AiKeysService } from './ai-keys.service';
import { OpenAiProvider } from './openai.provider';
import { AiProviderRegistry } from './provider-registry';

const env = {
  JWT_REFRESH_SECRET: 'a-long-enough-refresh-secret',
  AI_PROVIDER: 'live',
  SEMANTIC_RETRIEVAL: 'off',
} as unknown as Env;

function setup() {
  let row: { value: unknown } | null = null;
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async ({ create }: { create: { value: unknown } }) => {
        row = { value: create.value };
      }),
    },
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { keys: new AiKeysService(prisma, audit, env), audit, stored: () => row };
}

describe('AiKeysService', () => {
  it('stores the key sealed and returns it plain, and never logs it', async () => {
    const { keys, audit, stored } = setup();
    const secret = 'sk-ant-1234567890abcdefghij';
    await keys.set('anthropic', secret, 'u1');
    expect(JSON.stringify(stored())).not.toContain(secret);
    expect(await keys.load()).toEqual({ anthropic: secret });
    expect(JSON.stringify((audit.log as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(secret);
  });

  it('removes one vendor without touching the other', async () => {
    const { keys } = setup();
    await keys.set('anthropic', 'sk-ant-1234567890abcdefghij', 'u1');
    await keys.set('openai', 'sk-open-1234567890abcdefghij', 'u1');
    await keys.set('anthropic', null, 'u1');
    expect(await keys.load()).toEqual({ openai: 'sk-open-1234567890abcdefghij' });
  });
});

describe('AiProviderRegistry with saved keys', () => {
  it('uses a saved key without a restart and falls back to the environment when removed', async () => {
    const saved = { value: {} as Record<string, string> };
    const keys = { load: async () => ({ ...saved.value }) } as unknown as AiKeysService;
    const saveEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const registry = new AiProviderRegistry(env, keys);
      // status() lists models once a key exists; never let a test reach the vendor
      vi.spyOn(OpenAiProvider.prototype, 'listModels').mockResolvedValue(undefined);
      expect(registry.isConfigured('openai:gpt-5')).toBe(false);
      saved.value = { openai: 'sk-open-1234567890abcdefghij' };
      const status = await registry.status();
      const openai = status.find((s) => s.name === 'openai')!;
      expect(openai).toMatchObject({ configured: true, keySource: 'database', keyHint: 'ghij' });
      saved.value = {};
      await registry.refreshKeys();
      expect(registry.isConfigured('openai:gpt-5')).toBe(false);
    } finally {
      if (saveEnv) process.env.OPENAI_API_KEY = saveEnv;
    }
  });
});
