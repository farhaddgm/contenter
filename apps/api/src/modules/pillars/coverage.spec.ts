import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { CoverageService } from './coverage.module';

const admin = { id: 'a', role: 'ADMIN' } as AuthUser;
const editor = { id: 'e', role: 'EDITOR' } as AuthUser;

interface Opts {
  existing?: { id: string; name: string; targetShare: number | null; order: number }[];
  topic?: { businessId: string | null } | null;
  pillar?: unknown;
  contents?: unknown[];
}

function setup(o: Opts = {}) {
  const calls: string[] = [];
  const tx = {
    contentPillar: {
      findMany: async () => o.existing ?? [],
      deleteMany: vi.fn(async (a: unknown) => void calls.push(`delete ${JSON.stringify(a)}`)),
      update: vi.fn(
        async (a: { where: { id: string }; data: { name?: string } }) =>
          void calls.push(`update ${a.where.id} ${a.data.name ?? ''}`),
      ),
      create: vi.fn(
        async (a: { data: { name: string } }) => void calls.push(`create ${a.data.name}`),
      ),
    },
  };
  const contentFind = vi.fn(async (_a: unknown) => o.contents ?? []);
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    contentPillar: {
      findMany: async () => o.existing ?? [],
      findFirst: async () => o.pillar ?? null,
    },
    topic: { findUnique: async () => (o.topic === undefined ? { businessId: 'b1' } : o.topic) },
    content: { findMany: contentFind },
  };
  const log = vi.fn();
  const svc = new CoverageService(
    prisma as unknown as PrismaService,
    { log } as unknown as AuditService,
    {
      visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
    } as unknown as AccessService,
    {} as never,
  );
  return { svc, tx, calls, contentFind, log };
}

const row = (id: string, name: string) => ({ id, name, targetShare: null, order: 0 });

describe('CoverageService.save', () => {
  it('keeps a pillar with its id when renamed, creates new ones, deletes the ones left out', async () => {
    const { svc, calls, log } = setup({ existing: [row('p1', 'آموزش'), row('p2', 'فروش')] });
    await svc.save(
      'b1',
      { pillars: [{ id: 'p1', name: 'آموزش عملی', targetShare: 40 }, { name: 'داستان' }] },
      admin,
    );
    expect(calls[0]).toContain('delete');
    expect(calls[0]).toContain('"notIn":["p1"]');
    // parked first, then final names
    expect(calls).toContain('update p1 ~p1');
    expect(calls).toContain('update p1 آموزش عملی');
    expect(calls).toContain('create داستان');
    expect(calls.indexOf('update p1 ~p1')).toBeLessThan(calls.indexOf('update p1 آموزش عملی'));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'pillars.save' }));
  });

  it('refuses an id from another business and the same id twice', async () => {
    const a = setup({ existing: [row('p1', 'الف')] });
    await expect(
      a.svc.save('b1', { pillars: [{ id: 'other', name: 'ب' }] }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ existing: [row('p1', 'الف')] });
    await expect(
      b.svc.save(
        'b1',
        {
          pillars: [
            { id: 'p1', name: 'الف' },
            { id: 'p1', name: 'ب' },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CoverageService.assertForTopic / forTopic', () => {
  it('accepts a pillar of the topic’s business and refuses any other', async () => {
    await expect(
      setup({ pillar: { id: 'p1' } }).svc.assertForTopic('t1', 'p1'),
    ).resolves.toBeUndefined();
    await expect(setup({ pillar: null }).svc.assertForTopic('t1', 'p9')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      setup({ topic: { businessId: null }, pillar: { id: 'p1' } }).svc.assertForTopic('t1', 'p1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a topic without a business has no pillars', async () => {
    expect(await setup({ topic: { businessId: null } }).svc.forTopic('t1')).toEqual([]);
    expect(await setup({ existing: [row('p1', 'الف')] }).svc.forTopic('t1')).toHaveLength(1);
  });
});

describe('CoverageService.coverage', () => {
  const now = Date.now();
  const content = (over: Record<string, unknown>) => ({
    pillarId: null,
    platform: null,
    publishedAt: null,
    scheduledAt: null,
    createdAt: new Date(now - 3 * 86_400_000),
    topic: { platform: 'INSTAGRAM' },
    ...over,
  });
  const query = { days: 90, by: 'platform' as const, staleDays: 30 };

  it('counts approved and published content by the effective platform and the pillar', async () => {
    const { svc } = setup({
      existing: [row('p1', 'آموزش')],
      contents: [
        content({ pillarId: 'p1' }),
        content({ pillarId: 'p1', platform: 'X' }),
        content({}),
      ],
    });
    const r = await svc.coverage('b1', query, admin);
    const p1 = r.rows.find((x) => x.pillarId === 'p1')!;
    expect(p1.counts[r.columns.indexOf('INSTAGRAM')]).toBe(1);
    expect(p1.counts[r.columns.indexOf('X')]).toBe(1);
    expect(r.rows.at(-1)!.total).toBe(1);
    expect(r.total).toBe(3);
  });

  it('only reads approved or published contents of topics the caller can see', async () => {
    const a = setup();
    await a.svc.coverage('b1', query, admin);
    const where = (a.contentFind.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.topic).toEqual({ businessId: 'b1' });
    expect(JSON.stringify(where.AND)).toContain('APPROVED');
    expect(JSON.stringify(where.AND)).toContain('publishedAt');
    const e = setup();
    await e.svc.coverage('b1', query, editor);
    const ew = (e.contentFind.mock.calls[0]![0] as { where: { topic: unknown } }).where;
    expect(ew.topic).toEqual({ AND: [{ businessId: 'b1' }, { createdById: 'e' }] });
  });

  it('with no content it is an empty map', async () => {
    const r = await setup({ existing: [row('p1', 'آموزش')] }).svc.coverage('b1', query, admin);
    expect(r.total).toBe(0);
    expect(r.rows[0]).toMatchObject({ pillarId: 'p1', total: 0, stale: true });
  });
});
