import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { AuditService } from '../audit/audit.service';
import { CalendarService } from './calendar.module';

const user: AuthUser = { id: 'u1', email: 'u@x.test', role: 'EDITOR' };
const audit = { log: vi.fn() } as unknown as AuditService;
const access = {
  visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
} as unknown as AccessService;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'post',
  format: 'POST',
  status: 'APPROVED',
  scheduledAt: new Date('2026-10-20T09:00:00Z'),
  publishedAt: null,
  publishedUrl: null,
  topic: { id: 't1', title: 'T', platform: 'INSTAGRAM' },
  campaign: null,
  tags: [
    {
      id: 'g1',
      topicId: 't1',
      name: 'edu',
      color: 'blue',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    },
  ],
  ...over,
});

function make(opts: { content?: unknown; rows?: unknown[]; ready?: unknown[] } = {}) {
  const findMany = vi.fn();
  findMany.mockResolvedValueOnce(opts.rows ?? []).mockResolvedValueOnce(opts.ready ?? []);
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
  const prisma = {
    content: {
      findMany,
      findUnique: async () => (opts.content === undefined ? null : opts.content),
      update,
    },
    $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  return {
    svc: new CalendarService(prisma as unknown as PrismaService, audit, access),
    findMany,
    update,
  };
}

describe('CalendarService.list', () => {
  const query = {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
  };

  it('asks for what falls in the range, a published content at its publication', async () => {
    const { svc, findMany } = make();
    await svc.list({ ...query, topicId: 't1', tagId: 'g1' }, user);
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      topic: { createdById: 'u1' },
      topicId: 't1',
      tags: { some: { id: 'g1' } },
      OR: [
        { publishedAt: { gte: new Date(query.from), lt: new Date(query.to) } },
        { publishedAt: null, scheduledAt: { gte: new Date(query.from), lt: new Date(query.to) } },
      ],
    });
  });

  it('does not filter an admin by topic access', async () => {
    const { svc, findMany } = make();
    await svc.list(query, { ...user, role: 'ADMIN' });
    expect(findMany.mock.calls[0]![0].where.topic).toBeUndefined();
  });

  it('lists the approved, unplanned contents separately and without a state', async () => {
    const { svc, findMany } = make({
      rows: [row()],
      ready: [row({ id: 'c2', scheduledAt: null })],
    });
    const res = await svc.list(query, user);
    expect(findMany.mock.calls[1]![0]).toMatchObject({
      where: { status: 'APPROVED', scheduledAt: null, publishedAt: null },
      take: 50,
    });
    expect(res.items.map((i) => i.id)).toEqual(['c1']);
    expect(res.ready.map((i) => [i.id, i.state])).toEqual([['c2', null]]);
  });

  it('serializes dates and derives the state by code', async () => {
    const past = row({ id: 'late', scheduledAt: new Date('2000-01-01T00:00:00Z') });
    const live = row({ id: 'live', publishedAt: new Date('2026-10-05T10:00:00Z') });
    const { svc } = make({ rows: [past, live] });
    const res = await svc.list(query, user);
    expect(res.items[0]).toMatchObject({
      state: 'OVERDUE',
      scheduledAt: '2000-01-01T00:00:00.000Z',
    });
    expect(res.items[1]).toMatchObject({
      state: 'PUBLISHED',
      publishedAt: '2026-10-05T10:00:00.000Z',
    });
    expect(res.items[0]!.tags[0]!.createdAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('CalendarService.schedule', () => {
  const approved = { status: 'APPROVED', scheduledAt: null, publishedAt: null };

  it('plans an approved content', async () => {
    const { svc, update } = make({ content: approved });
    await svc.schedule('c1', { scheduledAt: '2026-10-20T09:00:00.000Z' }, user);
    expect(update.mock.calls[0]![0].data).toEqual({
      scheduledAt: new Date('2026-10-20T09:00:00.000Z'),
    });
  });

  it('refuses anything that is not approved', async () => {
    for (const status of ['DRAFT', 'IN_REVIEW', 'REJECTED', 'GENERATING']) {
      const { svc, update } = make({ content: { ...approved, status } });
      await expect(
        svc.schedule('c1', { scheduledAt: '2026-10-20T09:00:00.000Z' }, user),
      ).rejects.toThrow(ConflictException);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('refuses to move a published content, with or without a date', async () => {
    const published = { ...approved, publishedAt: new Date('2026-10-05T10:00:00Z') };
    await expect(
      make({ content: published }).svc.schedule(
        'c1',
        { scheduledAt: '2026-10-20T09:00:00.000Z' },
        user,
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      make({ content: published }).svc.schedule('c1', { scheduledAt: null }, user),
    ).rejects.toThrow(ConflictException);
  });

  it('takes a content off the calendar with null, whatever its status', async () => {
    const { svc, update } = make({
      content: { status: 'DRAFT', scheduledAt: new Date(), publishedAt: null },
    });
    await svc.schedule('c1', { scheduledAt: null }, user);
    expect(update.mock.calls[0]![0].data).toEqual({ scheduledAt: null });
  });

  it('404s for a missing content', async () => {
    await expect(make().svc.schedule('x', { scheduledAt: null }, user)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('CalendarService.publish', () => {
  const approved = { status: 'APPROVED', scheduledAt: new Date(), publishedAt: null };

  it('records the publication, defaulting to now, and keeps the plan', async () => {
    const { svc, update } = make({ content: approved });
    const before = Date.now();
    await svc.publish('c1', { url: 'https://example.com/p/1' }, user);
    const data = update.mock.calls[0]![0].data as { publishedAt: Date; publishedUrl: string };
    expect(data.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.publishedUrl).toBe('https://example.com/p/1');
    expect(data).not.toHaveProperty('scheduledAt');
  });

  it('accepts an earlier time but not a future one', async () => {
    const ok = make({ content: approved });
    await ok.svc.publish('c1', { publishedAt: '2026-10-01T10:00:00.000Z' }, user);
    expect(ok.update).toHaveBeenCalled();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await expect(
      make({ content: approved }).svc.publish('c1', { publishedAt: future }, user),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a draft and an already published content', async () => {
    await expect(
      make({ content: { ...approved, status: 'DRAFT' } }).svc.publish('c1', {}, user),
    ).rejects.toThrow(ConflictException);
    await expect(
      make({ content: { ...approved, publishedAt: new Date() } }).svc.publish('c1', {}, user),
    ).rejects.toThrow(ConflictException);
  });
});

describe('CalendarService.unpublish', () => {
  it('clears the publication and is safe to repeat', async () => {
    const live = make({
      content: { status: 'APPROVED', scheduledAt: null, publishedAt: new Date() },
    });
    await live.svc.unpublish('c1', user);
    expect(live.update.mock.calls[0]![0].data).toEqual({ publishedAt: null, publishedUrl: null });

    const notLive = make({ content: { status: 'APPROVED', scheduledAt: null, publishedAt: null } });
    await expect(notLive.svc.unpublish('c1', user)).resolves.toBeDefined();
  });
});
