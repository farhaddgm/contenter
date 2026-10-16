import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../../common/auth.decorators';
import type { AuditService } from '../audit/audit.service';
import { MetricsService } from './metrics.service';

const user: AuthUser = { id: 'u1', email: 'e@x.test', role: 'EDITOR' };
const audit = { log: vi.fn() } as unknown as AuditService;

const dayAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
const day = (d: Date) => d.toISOString().slice(0, 10);

interface Row {
  id: string;
  contentId: string;
  measuredAt: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  note: string;
  createdBy: null;
  createdAt: Date;
  updatedAt: Date;
}

function setup(publishedAt: Date | null = dayAgo(5), exists = true) {
  const rows: Row[] = [];
  const upsert = vi.fn(
    async (args: { where: { contentId_measuredAt: { contentId: string; measuredAt: Date } }; create: object; update: object }) => {
      const key = args.where.contentId_measuredAt;
      const found = rows.find((r) => r.measuredAt.getTime() === key.measuredAt.getTime());
      if (found) Object.assign(found, args.update);
      else
        rows.push({
          id: `m${rows.length + 1}`,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(args.create as Row),
        });
    },
  );
  const prisma = {
    content: {
      findUnique: async () => (exists ? { id: 'c1', publishedAt } : null),
    },
    contentMetric: {
      upsert,
      findMany: async () => [...rows].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime()),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r, content: { publishedAt } } : null;
      },
      findFirst: async () => null,
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        Object.assign(rows.find((r) => r.id === where.id)!, data);
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        rows.splice(rows.findIndex((r) => r.id === where.id), 1);
      }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { svc: new MetricsService(prisma as unknown as PrismaService, audit), rows, prisma };
}

describe('MetricsService.upsert', () => {
  it('refuses a content that is not published, and one that does not exist', async () => {
    await expect(setup(null).svc.upsert('c1', { views: 5 }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(setup(dayAgo(1), false).svc.upsert('c1', { views: 5 }, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('stores a reading for today by default and returns the summary', async () => {
    const { svc, rows } = setup();
    const out = await svc.upsert('c1', { views: 1000, likes: 50, saves: 50 }, user);
    expect(rows).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ measuredAt: day(new Date()), views: 1000, likes: 50 });
    expect(out.summary).toMatchObject({ readings: 1, engagement: 100, engagementRate: 0.1 });
  });

  it('replaces the reading of a day instead of adding a second one, clearing omitted numbers', async () => {
    const { svc, rows } = setup();
    const d = day(dayAgo(2));
    await svc.upsert('c1', { measuredAt: d, views: 100, likes: 9 }, user);
    await svc.upsert('c1', { measuredAt: d, views: 120 }, user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 120, likes: null });
  });

  it('rejects a date before publishing or in the future', async () => {
    const { svc } = setup(dayAgo(5));
    await expect(
      svc.upsert('c1', { measuredAt: day(dayAgo(10)), views: 1 }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.upsert('c1', { measuredAt: day(new Date(Date.now() + 10 * 24 * 3600 * 1000)), views: 1 }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes an audit entry', async () => {
    const { svc } = setup();
    await svc.upsert('c1', { views: 1 }, user);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'content.metric' }));
  });
});

describe('MetricsService.bulk', () => {
  it('saves every row, and saves nothing when one row is invalid', async () => {
    const { svc, rows } = setup(dayAgo(10));
    await svc.bulk(
      'c1',
      { rows: [{ measuredAt: day(dayAgo(3)), views: 10 }, { measuredAt: day(dayAgo(2)), views: 20 }] },
      user,
    );
    expect(rows).toHaveLength(2);

    const second = setup(dayAgo(10));
    await expect(
      second.svc.bulk(
        'c1',
        { rows: [{ measuredAt: day(dayAgo(3)), views: 10 }, { measuredAt: day(dayAgo(30)), views: 20 }] },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(second.prisma.contentMetric.upsert).not.toHaveBeenCalled();
  });

  it('refuses the same day twice in one request', async () => {
    const { svc } = setup(dayAgo(10));
    const d = day(dayAgo(2));
    await expect(
      svc.bulk('c1', { rows: [{ measuredAt: d, views: 1 }, { measuredAt: d, views: 2 }] }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MetricsService.update and remove', () => {
  it('changes some numbers and keeps the others', async () => {
    const { svc, rows } = setup();
    await svc.upsert('c1', { views: 100, likes: 5 }, user);
    await svc.update(rows[0].id, { likes: 8 }, user);
    expect(rows[0]).toMatchObject({ views: 100, likes: 8 });
  });

  it('will not leave a reading without any number', async () => {
    const { svc, rows } = setup();
    await svc.upsert('c1', { views: 100 }, user);
    await expect(svc.update(rows[0].id, { views: null }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('removes a reading and answers with the rest', async () => {
    const { svc, rows } = setup();
    await svc.upsert('c1', { measuredAt: day(dayAgo(2)), views: 1 }, user);
    await svc.upsert('c1', { views: 2 }, user);
    const out = await svc.remove(rows[0].id, user);
    expect(out.items).toHaveLength(1);
    await expect(svc.remove('nope', user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
