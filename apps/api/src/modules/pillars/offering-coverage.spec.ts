import { describe, expect, it, vi } from 'vitest';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { BusinessApi } from '../businesses/business-api';
import { CoverageService } from './coverage.module';

const admin = { id: 'a', role: 'ADMIN' } as AuthUser;
const editor = { id: 'e', role: 'EDITOR' } as AuthUser;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const core = (id: string, parentId: string | null = null) => ({
  id,
  parentId,
  name: `محصول ${id}`,
  aliases: [],
  kind: 'SERVICE',
  status: 'ACTIVE',
  push: 1,
  summary: '',
  features: [],
  priceAmount: null,
  priceCurrency: null,
  priceFrom: false,
  priceUnit: '',
  priceValidUntil: null,
  availableFrom: null,
  availableUntil: null,
});

function setup(contents: unknown[] = []) {
  const findMany = vi.fn(async (_a: unknown) => contents);
  const catalogForCoverage = vi.fn(async (_b: string) => ({
    offerings: [core('L'), core('V', 'L')],
    segments: [{ id: 's1', name: 'کارمند', kind: 'PERSONA' }],
    links: [{ offeringId: 'V', segmentId: 's1', fit: 2 }],
  }));
  const svc = new CoverageService(
    { content: { findMany } } as unknown as PrismaService,
    { log: vi.fn() } as unknown as AuditService,
    {
      visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
    } as unknown as AccessService,
    { catalogForCoverage } as unknown as BusinessApi,
  );
  return { svc, findMany, catalogForCoverage };
}

const content = (over: Record<string, unknown>) => ({
  offeringId: null,
  segmentId: null,
  publishedAt: null,
  scheduledAt: null,
  createdAt: ago(5),
  topic: { offeringId: null, segmentId: null },
  ...over,
});

describe('CoverageService.offeringCoverage (docs/73)', () => {
  it("uses a content's own offering and audience, else its project's", async () => {
    const { svc } = setup([
      content({ offeringId: 'V', segmentId: 's1' }),
      content({ topic: { offeringId: 'V', segmentId: 's1' } }),
      content({ offeringId: 'L', topic: { offeringId: 'V', segmentId: null } }),
      content({}),
    ]);
    const r = await svc.offeringCoverage('b1', { staleDays: 30 }, admin);
    const row = (id: string) => r.rows.find((x) => x.offeringId === id)!;
    expect(row('V').own[90]).toBe(2);
    expect(row('L').own[90]).toBe(1);
    expect(row('L').subtree[90]).toBe(3);
    expect(r.withoutOffering[90]).toBe(1);
    expect(r.cells.find((c) => c.offeringId === 'V' && c.segmentId === 's1')).toMatchObject({
      linked: true,
      count: 2,
      gap: false,
    });
  });

  it('dates a content by publishing, then schedule, then creation', async () => {
    const { svc } = setup([
      content({ offeringId: 'V', publishedAt: ago(2), scheduledAt: ago(60), createdAt: ago(80) }),
      content({ offeringId: 'V', scheduledAt: ago(45), createdAt: ago(80) }),
      content({ offeringId: 'V', createdAt: ago(85) }),
    ]);
    const r = await svc.offeringCoverage('b1', { staleDays: 30 }, admin);
    expect(r.rows.find((x) => x.offeringId === 'V')!.own).toEqual({ 30: 1, 60: 2, 90: 3 });
  });

  it('reads only approved or published contents of the last 90 days from the projects the caller can see', async () => {
    const { svc, findMany, catalogForCoverage } = setup();
    await svc.offeringCoverage('b1', { staleDays: 30 }, editor);
    expect(catalogForCoverage).toHaveBeenCalledWith('b1');
    const args = findMany.mock.calls[0]![0] as {
      where: { topic: { AND: unknown[] }; currentVersionId: unknown; AND: { OR: unknown[] }[] };
    };
    expect(args.where.topic).toEqual({ AND: [{ businessId: 'b1' }, { createdById: 'e' }] });
    expect(args.where.currentVersionId).toEqual({ not: null });
    expect(args.where.AND[0]!.OR).toEqual([{ status: 'APPROVED' }, { publishedAt: { not: null } }]);
    const admins = setup();
    await admins.svc.offeringCoverage('b1', { staleDays: 30 }, admin);
    expect((admins.findMany.mock.calls[0]![0] as { where: { topic: unknown } }).where.topic).toEqual({
      businessId: 'b1',
    });
  });

  it('flags the stale offerings with the staleDays the caller chose', async () => {
    const { svc } = setup([content({ offeringId: 'V', createdAt: ago(20) })]);
    // 20 days ago: fresh for 30 days (the line is covered through its variant), stale for 10
    expect((await svc.offeringCoverage('b1', { staleDays: 30 }, admin)).rows.map((r) => r.stale)).toEqual([false, false]);
    expect((await svc.offeringCoverage('b1', { staleDays: 10 }, admin)).rows.map((r) => r.stale)).toEqual([true, true]);
    const none = await setup([]).svc.offeringCoverage('b1', { staleDays: 10 }, admin);
    expect(none.rows.map((r) => r.stale)).toEqual([true, true]);
  });
});
