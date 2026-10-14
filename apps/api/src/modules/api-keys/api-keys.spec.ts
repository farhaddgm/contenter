import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { API_KEY_RATE_PER_MINUTE, ApiKeysService, hashKey } from './api-keys.service';

const editor = { id: 'u1', email: 'e@x.test', role: 'EDITOR' } as AuthUser;
const viewer = { id: 'u2', email: 'v@x.test', role: 'VIEWER' } as AuthUser;

interface Row {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  user?: { id: string; email: string; role: string; isActive: boolean };
}

function setup(opts: { activeCount?: number; existing?: Row | null } = {}) {
  const created: Row[] = [];
  const update = vi.fn(async (_a: unknown) => ({}));
  const prisma = {
    apiKey: {
      count: vi.fn(async (_a: unknown) => opts.activeCount ?? 0),
      findUnique: vi.fn(async (a: { where: { prefix: string } }) => {
        if (opts.existing && opts.existing.prefix === a.where.prefix) return opts.existing;
        return created.find((r) => r.prefix === a.where.prefix) ?? null;
      }),
      findFirst: vi.fn(async () => opts.existing ?? null),
      findMany: vi.fn(async () => created),
      create: vi.fn(
        async ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'> }) => {
          const row: Row = {
            ...data,
            id: `k${created.length + 1}`,
            createdAt: new Date(),
            lastUsedAt: null,
            revokedAt: null,
          };
          created.push(row);
          return row;
        },
      ),
      update,
    },
  };
  const log = vi.fn();
  const svc = new ApiKeysService(
    prisma as unknown as PrismaService,
    { log } as unknown as AuditService,
  );
  return { svc, prisma, created, log, update };
}

const live = (key: string, over: Partial<Row> = {}): Row => ({
  id: 'k1',
  userId: 'u1',
  name: 'n8n',
  prefix: key.slice(0, 12),
  hash: hashKey(key),
  scopes: ['contents:read', 'contents:write'],
  expiresAt: new Date(Date.now() + 86_400_000),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  user: { id: 'u1', email: 'e@x.test', role: 'EDITOR', isActive: true },
  ...over,
});

describe('ApiKeysService.create', () => {
  it('returns the whole key once and stores only its hash and prefix', async () => {
    const { svc, created, log } = setup();
    const k = await svc.create(editor, { name: ' n8n ', scopes: ['contents:read'] });
    expect(k.key).toMatch(/^ctk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(k.prefix).toBe(k.key.slice(0, 12));
    expect(created[0]!.hash).toBe(hashKey(k.key));
    expect(JSON.stringify(created[0])).not.toContain(k.key);
    expect(k.name).toBe('n8n');
    // 90 days by default
    const days = (new Date(k.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
    // the audit entry never carries the key or its hash
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.create' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(k.key);
    expect(JSON.stringify(log.mock.calls)).not.toContain(hashKey(k.key));
  });

  it('makes a different key every time', async () => {
    const { svc } = setup();
    const a = await svc.create(editor, { name: 'a', scopes: ['contents:read'] });
    const b = await svc.create(editor, { name: 'b', scopes: ['contents:read'] });
    expect(a.key).not.toBe(b.key);
  });

  it('a read-only account cannot hold a write scope', async () => {
    const { svc } = setup();
    await expect(
      svc.create(viewer, { name: 'k', scopes: ['contents:write'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create(viewer, { name: 'k', scopes: ['calendar:read'] }),
    ).resolves.toBeDefined();
  });

  it('allows five active keys per person, no more', async () => {
    await expect(
      setup({ activeCount: 5 }).svc.create(editor, { name: 'k', scopes: ['contents:read'] }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup({ activeCount: 4 }).svc.create(editor, { name: 'k', scopes: ['contents:read'] }),
    ).resolves.toBeDefined();
  });
});

describe('ApiKeysService.authenticate', () => {
  const KEY = 'ctk_0123abcd_' + 'A'.repeat(43);

  it('accepts a live key and speaks for its owner with the owner’s current role', async () => {
    const { svc } = setup({ existing: live(KEY) });
    const a = await svc.authenticate(KEY);
    expect(a.user).toEqual({ id: 'u1', email: 'e@x.test', role: 'EDITOR' });
    expect(a.keyId).toBe('k1');
    expect(a.scopes).toEqual(['contents:read', 'contents:write']);
  });

  it.each([
    ['not a key at all', 'hello'],
    ['the wrong secret', 'ctk_0123abcd_' + 'B'.repeat(43)],
    ['an unknown prefix', 'ctk_ffffffff_' + 'A'.repeat(43)],
    ['a truncated key', KEY.slice(0, 30)],
  ])('refuses %s with 401 and no detail', async (_n, bad) => {
    const { svc } = setup({ existing: live(KEY) });
    await expect(svc.authenticate(bad)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.authenticate(bad)).rejects.toThrow('Invalid API key');
  });

  it('refuses a revoked key, an expired key and a deactivated owner', async () => {
    for (const over of [
      { revokedAt: new Date() },
      { expiresAt: new Date(Date.now() - 1000) },
      { user: { id: 'u1', email: 'e@x.test', role: 'EDITOR', isActive: false } },
    ]) {
      await expect(
        setup({ existing: live(KEY, over) }).svc.authenticate(KEY),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('a demoted owner loses the write scopes of the key', async () => {
    const row = live(KEY, {
      user: { id: 'u1', email: 'e@x.test', role: 'VIEWER', isActive: true },
    });
    const a = await setup({ existing: row }).svc.authenticate(KEY);
    expect(a.scopes).toEqual(['contents:read']);
  });

  it('answers 429 over the per-key rate limit, and counts keys separately', async () => {
    const { svc } = setup({ existing: live(KEY) });
    for (let i = 0; i < API_KEY_RATE_PER_MINUTE; i++) await svc.authenticate(KEY);
    await expect(svc.authenticate(KEY)).rejects.toMatchObject({ status: 429 });
    const other = setup({ existing: live(KEY, { id: 'k2' }) });
    await expect(other.svc.authenticate(KEY)).resolves.toBeDefined();
  });

  it('writes lastUsedAt at most once a minute, and never fails because it could not', async () => {
    const { svc, update } = setup({ existing: live(KEY) });
    update.mockRejectedValueOnce(new Error('db down'));
    await svc.authenticate(KEY);
    await svc.authenticate(KEY);
    await svc.authenticate(KEY);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('ApiKeysService.revoke', () => {
  it('revokes the caller’s own key and audits it', async () => {
    const { svc, update, log } = setup({ existing: live('ctk_0123abcd_' + 'A'.repeat(43)) });
    await svc.revoke(editor, 'k1');
    expect(update.mock.calls[0]![0]).toMatchObject({
      where: { id: 'k1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.revoke' }));
  });

  it('is a no-op for a key that is already revoked, and 404 for somebody else’s', async () => {
    const done = setup({
      existing: live('ctk_0123abcd_' + 'A'.repeat(43), { revokedAt: new Date() }),
    });
    await done.svc.revoke(editor, 'k1');
    expect(done.update).not.toHaveBeenCalled();
    await expect(setup({ existing: null }).svc.revoke(editor, 'k9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
