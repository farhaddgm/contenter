import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { AuditService } from '../audit/audit.service';
import { formatBusinessCatalog, type OfferingForPrompt } from '../ai/context';
import { BusinessApi } from './business-api';
import { OfferingsService } from './offerings.service';
import { SegmentsService } from './segments.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;
const NOW = new Date('2026-10-27T10:00:00Z');

const offering = (over: Partial<OfferingForPrompt> = {}): OfferingForPrompt => ({
  id: 'o1',
  name: 'تسهیلات',
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
  ...over,
});

describe('[CATALOG] with a product tree (docs/73)', () => {
  const flat = [offering({ id: 'a', name: 'الف' }), offering({ id: 'b', name: 'ب', summary: 'توضیح' })];

  it('keeps the flat list byte-for-byte while there is no tree and no phrase', () => {
    const plain = formatBusinessCatalog(flat, NOW);
    // a parent that is not in the list (inactive) changes nothing either
    expect(formatBusinessCatalog([{ ...flat[0]!, parentId: 'gone' }, flat[1]!], NOW)).toBe(plain);
    expect(plain).not.toContain('Part of');
    expect(plain).not.toContain('Indented');
    expect(plain).not.toContain('Never say');
  });

  it('puts variants under their line, indented, saying what they belong to', () => {
    const out = formatBusinessCatalog(
      [
        offering({ id: 'l', name: 'تسهیلات ویپاد', summary: 'خط محصول' }),
        offering({ id: 'x', name: 'بیمه' }),
        offering({ id: 'v1', name: 'تسهیلات تجهیزات', parentId: 'l', features: ['۱۲ ماهه'] }),
        offering({ id: 'v2', name: 'تسهیلات حقوق‌بگیر', parentId: 'l' }),
      ],
      NOW,
    );
    const lines = out.split('\n');
    const at = (text: string) => lines.findIndex((l) => l.includes(text));
    expect(at('تسهیلات ویپاد')).toBeLessThan(at('تسهیلات تجهیزات'));
    expect(at('تسهیلات حقوق‌بگیر')).toBeLessThan(at('بیمه'));
    expect(lines[at('تسهیلات تجهیزات')]).toMatch(/^ {2}- \[SERVICE\] تسهیلات تجهیزات/);
    expect(lines[at('تسهیلات تجهیزات') + 1]).toBe('    Part of: تسهیلات ویپاد');
    expect(out).toContain('    Features: ۱۲ ماهه');
    expect(out).toMatch(/Indented items are variants of the item above them/);
  });

  it('tells the model never to describe a variant with the phrases of its line, and prints them once', () => {
    const out = formatBusinessCatalog(
      [
        offering({ id: 'l', name: 'خط', guardrails: ['سود تضمینی'] }),
        offering({ id: 'v', name: 'گونه', parentId: 'l', guardrails: ['سود  تضمینی', 'بدون ضامن'] }),
      ],
      NOW,
    );
    expect(out).toMatch(/Never write the phrases listed after "Never say"/);
    expect(out).toContain('  Never say: سود تضمینی\n');
    expect(out).toContain('    Never say: سود  تضمینی | بدون ضامن');
    expect(out.match(/Never say:/g)).toHaveLength(2);
  });

  it('still tells the model the phrases of a line that is switched off (it is read through `parent`)', () => {
    const out = formatBusinessCatalog(
      [offering({ id: 'v', name: 'گونه', parentId: 'gone', parent: { guardrails: ['سود تضمینی'] } })],
      NOW,
    );
    expect(out).toContain('  Never say: سود تضمینی');
    expect(out).toMatch(/Never write the phrases listed after "Never say"/);
    expect(out).not.toContain('Part of');
  });

  it('does not print phrases of an item that cannot be sold', () => {
    const out = formatBusinessCatalog([offering({ status: 'PAUSED', guardrails: ['x y'] })], NOW);
    expect(out).not.toContain('Never say:');
  });

  it('a variant keeps its own availability: a paused line does not hide its variants', () => {
    const out = formatBusinessCatalog(
      [
        offering({ id: 'l', name: 'خط', status: 'PAUSED' }),
        offering({ id: 'v', name: 'گونه', parentId: 'l', summary: 'قابل فروش' }),
      ],
      NOW,
    );
    expect(out).toContain('NOT AVAILABLE] خط');
    expect(out).toMatch(/\[SERVICE\] گونه/);
    expect(out).toContain('قابل فروش');
  });
});

const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  businessId: 'b1',
  name: 'تسهیلات',
  aliases: [],
  kind: 'SERVICE',
  status: 'ACTIVE',
  push: 1,
  stock: 'IN_STOCK',
  parentId: null,
  guardrails: [],
  peakMonths: [],
  complementIds: [],
  substituteIds: [],
  summary: '',
  features: [],
  claims: [],
  priceAmount: null,
  priceCurrency: null,
  priceFrom: false,
  priceUnit: '',
  priceValidUntil: null,
  availableFrom: null,
  availableUntil: null,
  url: '',
  note: '',
  source: 'ADMIN',
  verified: true,
  isActive: true,
  evidence: '',
  sortOrder: 0,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  segmentLinks: [],
  ...over,
});

function setup(
  opts: { rows?: Record<string, unknown>[]; children?: number; segments?: string[]; links?: unknown[] } = {},
) {
  const rows = opts.rows ?? [row({ id: 'L' }), row({ id: 'P', name: 'محصول', parentId: 'L' }), row({ id: 'X', name: 'مستقل' })];
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  const prisma = {
    business: { findUnique: async () => ({ id: 'b1' }) },
    businessOffering: {
      count: async (args?: { where?: { parentId?: string } }) =>
        args?.where?.parentId ? (opts.children ?? 0) : 0,
      findFirst: async () => null,
      findMany: async () => rows.map((r) => ({ id: r.id, parentId: r.parentId })),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return row({ ...data, id: 'new' });
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updated.push(data);
        return row({ ...rows.find((r) => r.id === where.id), ...data });
      },
      delete: vi.fn(),
    },
    businessSegment: {
      count: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => (opts.segments ?? ['s1', 's2']).includes(id)).length,
    },
    offeringSegment: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        links.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const audit = { log: vi.fn() };
  const svc = new OfferingsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    { enqueue: vi.fn() } as unknown as AiJobsService,
  );
  return { svc, created, updated, links, prisma, audit };
}

describe('OfferingsService: the product tree', () => {
  it('creates a variant under an offering of the business and returns the parent id', async () => {
    const { svc, created } = setup();
    const out = await svc.create('b1', { name: 'گونهٔ جدید', parentId: 'P' }, user);
    // L → P → new = 3 levels
    expect(created[0]).toMatchObject({ parentId: 'P', guardrails: [] });
    expect(out.parentId).toBe('P');
  });

  it('refuses a parent from elsewhere, a fourth level, and a loop', async () => {
    const { svc } = setup({
      rows: [row({ id: 'L' }), row({ id: 'P', parentId: 'L' }), row({ id: 'V', parentId: 'P' })],
    });
    await expect(svc.create('b1', { name: 'x', parentId: 'other-business' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.create('b1', { name: 'x', parentId: 'V' }, user)).rejects.toThrow(/3 levels/);
    await expect(svc.update('L', { parentId: 'V' }, user)).rejects.toThrow(/own variants/);
    await expect(svc.update('L', { parentId: 'L' }, user)).rejects.toThrow(/own parent/);
  });

  it('moves a row under another, and null makes it a root again', async () => {
    const { svc, updated } = setup();
    await svc.update('X', { parentId: 'L' }, user);
    expect(updated[0]).toMatchObject({ parentId: 'L' });
    await svc.update('P', { parentId: null }, user);
    expect(updated[1]).toMatchObject({ parentId: null });
  });

  it('an update that does not mention the parent leaves the tree and the phrases alone', async () => {
    const { svc, updated } = setup();
    await svc.update('P', { push: 3 }, user);
    expect(updated[0]).not.toHaveProperty('parentId');
    expect(updated[0]).not.toHaveProperty('guardrails');
    await svc.update('P', { guardrails: ['سود تضمینی'] }, user);
    expect(updated[1]).toMatchObject({ guardrails: ['سود تضمینی'] });
  });

  it('does not delete a line from under its variants', async () => {
    await expect(setup({ children: 2 }).svc.remove('L', user)).rejects.toThrow(/variants first/);
    const ok = setup({ children: 0 });
    await ok.svc.remove('X', user);
    expect(ok.prisma.businessOffering.delete).toHaveBeenCalled();
    await expect(setup({ rows: [] }).svc.remove('zz', user)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OfferingsService.setSegments', () => {
  it('replaces the audiences, main first, and logs only counts', async () => {
    const { svc, links, prisma, audit } = setup();
    const out = await svc.setSegments(
      'P',
      { links: [{ segmentId: 's1', fit: 1 }, { segmentId: 's2' }] },
      user,
    );
    expect(prisma.offeringSegment.deleteMany).toHaveBeenCalledWith({ where: { offeringId: 'P' } });
    expect(links).toEqual([
      { offeringId: 'P', segmentId: 's1', fit: 1 },
      { offeringId: 'P', segmentId: 's2', fit: 2 },
    ]);
    expect(out.id).toBe('P');
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('s1');
  });

  it('refuses an audience of another business, a repeat and too many', async () => {
    await expect(
      setup().svc.setSegments('P', { links: [{ segmentId: 'foreign' }] }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup().svc.setSegments('P', { links: [{ segmentId: 's1' }, { segmentId: 's1' }] }, user),
    ).rejects.toThrow();
    await expect(
      setup().svc.setSegments(
        'P',
        { links: Array.from({ length: 9 }, (_, i) => ({ segmentId: `s${i}` })) },
        user,
      ),
    ).rejects.toThrow();
  });

  it('an empty list clears them', async () => {
    const { svc, links } = setup();
    await svc.setSegments('P', { links: [] }, user);
    expect(links).toEqual([]);
  });

  it('lists the links with each row, main audience first', async () => {
    const { svc } = setup({
      rows: [
        row({
          id: 'P',
          segmentLinks: [
            { segmentId: 'a', fit: 1 },
            { segmentId: 'b', fit: 2 },
          ],
        }),
      ],
    });
    const out = await svc.setSegments('P', { links: [] }, user);
    expect(out.segments.map((l) => l.segmentId)).toEqual(['b', 'a']);
  });
});

describe('BusinessApi.offeringsForQuality with a tree', () => {
  it('gives a variant the never-say phrases of its line', async () => {
    const prisma = {
      businessOffering: {
        findMany: vi.fn(async () => [
          offering({ id: 'l', name: 'خط', guardrails: ['سود تضمینی'], priceAmount: new Prisma.Decimal('1') }),
          offering({ id: 'v', name: 'گونه', parentId: 'l', guardrails: ['بدون ضامن'] }),
        ]),
      },
    };
    const rules = await new BusinessApi(prisma as unknown as PrismaService).offeringsForQuality('b1', NOW);
    expect(rules.find((r) => r.name === 'گونه')?.guardrails).toEqual(['بدون ضامن', 'سود تضمینی']);
    expect(rules.find((r) => r.name === 'خط')?.guardrails).toEqual(['سود تضمینی']);
  });
});

const segRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  businessId: 'b1',
  kind: 'PERSONA',
  name: 'کارمند',
  summary: '',
  goals: [],
  pains: [],
  objections: [],
  channels: [],
  messageAngle: '',
  note: 'internal',
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  offerings: [{ offeringId: 'o2' }, { offeringId: 'o1' }],
  ...over,
});

function segSetup(opts: { count?: number; clash?: boolean; row?: unknown } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    business: { findUnique: async () => ({ id: 'b1' }) },
    businessSegment: {
      count: async () => opts.count ?? 0,
      findFirst: async () => (opts.clash ? { id: 'other' } : null),
      findMany: async () => [segRow()],
      findUnique: async () => (opts.row === null ? null : segRow()),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return segRow({ ...data, id: 'new' });
      },
      update: async ({ data }: { data: Record<string, unknown> }) => segRow(data),
      delete: vi.fn(),
    },
  };
  const audit = { log: vi.fn() };
  return {
    svc: new SegmentsService(prisma as unknown as PrismaService, audit as unknown as AuditService),
    created,
    audit,
    prisma,
  };
}

describe('SegmentsService', () => {
  it('creates an audience typed by the admin and lists the offerings it is linked to', async () => {
    const { svc, created, audit } = segSetup();
    const out = await svc.create('b1', { name: 'کارمند', kind: 'PERSONA', pains: ['وثیقه'] }, user);
    expect(created[0]).toMatchObject({ businessId: 'b1', name: 'کارمند', pains: ['وثیقه'], updatedById: 'u1' });
    expect(out.offeringIds).toEqual(['o1', 'o2']);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('internal');
    expect((await svc.list('b1'))[0]!.offeringIds).toEqual(['o1', 'o2']);
  });

  it('refuses a duplicate name and a full list', async () => {
    await expect(segSetup({ clash: true }).svc.create('b1', { name: 'x' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(segSetup({ count: 40 }).svc.create('b1', { name: 'x' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('answers 404 for a missing audience, updates and deletes an existing one', async () => {
    await expect(segSetup({ row: null }).svc.update('zz', { summary: 's' }, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const ok = segSetup();
    await expect(ok.svc.update('s1', { summary: 'خلاصه' }, user)).resolves.toMatchObject({ summary: 'خلاصه' });
    await ok.svc.remove('s1', user);
    expect(ok.prisma.businessSegment.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });
});
