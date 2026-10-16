import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.module';
import { GoldenService } from './golden.module';

const admin = { id: 'a', role: 'ADMIN' } as AuthUser;
const editor = { id: 'e', role: 'EDITOR' } as AuthUser;

function setup(content: unknown, rows: unknown[] = []) {
  const update = vi.fn(async (_args: unknown) => ({ goldenAt: new Date('2026-10-14') }));
  const findMany = vi.fn(async (_args: unknown) => rows);
  const log = vi.fn();
  const prisma = { content: { findUnique: async () => content, update, findMany } };
  const svc = new GoldenService(
    prisma as unknown as PrismaService,
    { log } as unknown as AuditService,
    {
      visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
    } as unknown as AccessService,
    { getGolden: async () => ({ maxExamples: 2, maxChars: 1500 }) } as unknown as SettingsService,
  );
  return { svc, update, findMany, log };
}

const approved = {
  status: 'APPROVED',
  publishedAt: null,
  currentVersionId: 'v1',
  goldenAt: null,
  topic: { businessId: 'b1' },
};

describe('GoldenService.set', () => {
  it('marks approved content and audits it', async () => {
    const { svc, update, log } = setup(approved);
    await svc.set('c1', { golden: true }, admin);
    expect(update.mock.calls[0]![0]).toMatchObject({
      where: { id: 'c1' },
      data: { goldenAt: expect.any(Date) },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.golden', entityId: 'c1' }),
    );
  });

  it('accepts published content whatever its status', async () => {
    const { svc, update } = setup({ ...approved, status: 'DRAFT', publishedAt: new Date() });
    await svc.set('c1', { golden: true }, admin);
    expect(update).toHaveBeenCalledOnce();
  });

  it.each([
    ['a draft', { ...approved, status: 'DRAFT' }],
    ['a content without text', { ...approved, currentVersionId: null }],
    ['a project without a business', { ...approved, topic: { businessId: null } }],
  ])('refuses %s', async (_name, content) => {
    const { svc, update } = setup(content);
    await expect(svc.set('c1', { golden: true }, admin)).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('unmarking always works, even once the content is no longer approved; repeating is a no-op', async () => {
    const marked = { ...approved, status: 'DRAFT', goldenAt: new Date('2026-10-01') };
    const a = setup(marked);
    await a.svc.set('c1', { golden: false }, admin);
    expect(a.update.mock.calls[0]![0]).toMatchObject({ data: { goldenAt: null } });
    expect(a.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.golden_remove' }),
    );

    const again = setup(approved);
    await again.svc.set('c1', { golden: false }, admin);
    expect(again.update).not.toHaveBeenCalled();
    expect(again.log).not.toHaveBeenCalled();

    const keep = setup({ ...approved, goldenAt: new Date('2026-10-01') });
    await keep.svc.set('c1', { golden: true }, admin);
    expect(keep.update).not.toHaveBeenCalled();
  });

  it('a missing content is a 404', async () => {
    await expect(setup(null).svc.set('x', { golden: true }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('GoldenService.list', () => {
  const rows = [
    {
      id: 'c1',
      topicId: 't1',
      title: 'پست',
      platform: null,
      format: 'POST',
      status: 'APPROVED',
      publishedAt: null,
      goldenAt: new Date('2026-10-10'),
      topic: { platform: 'INSTAGRAM' },
      currentVersion: { body: 'الف'.repeat(400) },
    },
    {
      id: 'c2',
      topicId: 't1',
      title: 'برگشته',
      platform: 'X',
      format: 'THREAD',
      status: 'DRAFT',
      publishedAt: null,
      goldenAt: new Date('2026-10-09'),
      topic: { platform: 'INSTAGRAM' },
      currentVersion: { body: 'x' },
    },
  ];

  it('lists with the effective platform, a short excerpt and whether each is still eligible', async () => {
    const { svc } = setup(null, rows);
    const r = await svc.list('b1', admin);
    expect(r.maxExamples).toBe(2);
    expect(r.items.map((i) => [i.id, i.platform, i.eligible])).toEqual([
      ['c1', 'INSTAGRAM', true],
      ['c2', 'X', false],
    ]);
    expect(r.items[0]!.excerpt.length).toBe(240);
  });

  it('only reads topics the caller can see', async () => {
    const a = setup(null, rows);
    await a.svc.list('b1', admin);
    expect(a.findMany.mock.calls[0]![0]).toMatchObject({ where: { topic: { businessId: 'b1' } } });
    const e = setup(null, rows);
    await e.svc.list('b1', editor);
    expect(e.findMany.mock.calls[0]![0]).toMatchObject({
      where: { topic: { AND: [{ businessId: 'b1' }, { createdById: 'e' }] } },
    });
  });
});
