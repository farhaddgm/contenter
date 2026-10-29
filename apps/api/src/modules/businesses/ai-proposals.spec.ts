import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { AuditService } from '../audit/audit.service';
import { BusinessOfferingsExtractRunner } from '../ai/runners/business-offerings.runner';
import { BusinessSegmentsProposeRunner } from '../ai/runners/business-segments.runner';
import { OfferingsService } from './offerings.service';
import { SegmentsService } from './segments.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;
const job = (input: unknown = {}) => ({ id: 'j1', targetId: 'b1', input }) as never;
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

const baseBusiness = (sections: { key: string; content: string }[]) => ({
  id: 'b1',
  name: 'Acme',
  tagline: '',
  industry: '',
  website: '',
  location: '',
  language: 'fa',
  sections: sections.map((s) => ({ ...s, source: 'ADMIN', reviewedAt: null })),
  facts: [],
  terms: [],
  assets: [],
  offerings: [],
});

// ───────────────────────── audiences: the runner ─────────────────────────

describe('BusinessSegmentsProposeRunner (docs/73 phase 4)', () => {
  const PERSONAS = 'مخاطب اصلی ما کارمندان با حقوق ثابت هستند که وام تجهیزات می‌خواهند.\nصاحبان مغازه‌های کوچک هم مشتری‌اند.';

  function runner(
    data: unknown,
    opts: {
      sections?: { key: string; content: string }[];
      existing?: { name: string }[];
      offerings?: { id: string; name: string; aliases: string[] }[];
      load?: Record<string, number>;
      duplicate?: string;
    } = {},
  ) {
    const created: Record<string, unknown>[] = [];
    const links: Record<string, unknown>[] = [];
    let n = 0;
    const prisma = {
      business: {
        findUnique: async () => baseBusiness(opts.sections ?? [{ key: 'PERSONAS', content: PERSONAS }]),
      },
      businessSegment: {
        findMany: async () => opts.existing ?? [],
        create: async ({ data: d }: { data: Record<string, unknown> }) => {
          if (opts.duplicate && d.name === opts.duplicate) {
            throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
          }
          created.push(d);
          return { id: `s${++n}` };
        },
      },
      businessOffering: { findMany: async () => opts.offerings ?? [] },
      businessFact: { findMany: async () => [] },
      businessReference: { findMany: async () => [] },
      offeringSegment: {
        groupBy: async () => Object.entries(opts.load ?? {}).map(([offeringId, c]) => ({ offeringId, _count: { _all: c } })),
        createMany: async ({ data: d }: { data: Record<string, unknown>[] }) => {
          links.push(...d);
          return { count: d.length };
        },
      },
    };
    const execute = vi.fn(async (_args: unknown) => ({
      data,
      model: 'm',
      usage,
      prompt: { key: 'business_segments_propose', version: 1 },
    }));
    const r = new BusinessSegmentsProposeRunner(prisma as unknown as PrismaService, { execute } as unknown as AiExecutor);
    return { r, created, links, execute };
  }

  const proposal = (over: Record<string, unknown> = {}) => ({
    kind: 'PERSONA',
    name: 'کارمند',
    summary: 'حقوق ثابت',
    goals: [],
    pains: ['وثیقه'],
    objections: [],
    channels: [],
    messageAngle: 'بدون وثیقه',
    offerings: [],
    evidence: 'کارمندان با حقوق ثابت هستند که وام تجهیزات می‌خواهند',
    ...over,
  });

  it('saves a backed audience as an inactive, unverified AI row, and shows the model only the audience material', async () => {
    const { r, created, execute } = runner({ segments: [proposal()], notes: '' });
    const out = await r.run(job());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      businessId: 'b1',
      kind: 'PERSONA',
      name: 'کارمند',
      pains: ['وثیقه'],
      source: 'AI',
      verified: false,
      isActive: false,
      jobId: 'j1',
    });
    expect(created[0]!.evidence).toContain('حقوق ثابت');
    expect(out.output).toMatchObject({ saved: 1, dropped: 0, links: 0 });
    const vars = (execute.mock.calls[0]![0] as { vars: Record<string, string> }).vars;
    expect(vars.sources).toContain('[S2] Personas section of the profile');
    expect(vars.existing).toBe('(none)');
    expect(vars.catalog).toBe('(none)');
  });

  it('discards an audience whose quote the sources do not contain', async () => {
    const { r, created } = runner({
      segments: [proposal({ name: 'ساختگی', evidence: 'این جمله در هیچ منبعی نیست' }), proposal({ name: 'مغازه‌دار', evidence: 'صاحبان مغازه‌های کوچک هم مشتری‌اند' })],
      notes: '',
    });
    const out = await r.run(job());
    expect(created.map((c) => c.name)).toEqual(['مغازه‌دار']);
    expect(out.output).toMatchObject({ saved: 1, dropped: 1 });
  });

  it('links only offerings of the catalog, and not past what an offering can take', async () => {
    const { r, links } = runner(
      {
        segments: [
          proposal({
            offerings: [
              { name: 'تسهیلات تجهیزات', fit: 2 },
              { name: 'وام مسکن', fit: 1 },
              { name: 'محصول ناشناس', fit: 2 },
            ],
          }),
        ],
        notes: '',
      },
      {
        offerings: [
          { id: 'o1', name: 'تسهیلات تجهیزات', aliases: [] },
          { id: 'o2', name: 'تسهیلات مسکن', aliases: ['وام مسکن'] },
        ],
        load: { o2: 8 },
      },
    );
    const out = await r.run(job());
    // o2 already has 8 audiences, so only o1 is linked; the unknown name is counted, not linked
    expect(links).toEqual([{ offeringId: 'o1', segmentId: 's1', fit: 2 }]);
    expect(out.output).toMatchObject({ saved: 1, links: 1, unknownOfferings: 1 });
  });

  it('skips a name the admin already has, and a name that appeared while it ran', async () => {
    const stored = runner({ segments: [proposal()], notes: '' }, { existing: [{ name: 'کارمند' }] });
    await stored.r.run(job());
    expect(stored.created).toEqual([]);
    const race = runner({ segments: [proposal()], notes: '' }, { duplicate: 'کارمند' });
    await expect(race.r.run(job())).resolves.toMatchObject({ output: { saved: 0 } });
  });

  it('stops with a clear error when there is nothing to read or the list is full', async () => {
    const empty = runner({ segments: [], notes: '' }, { sections: [] });
    await expect(empty.r.run(job())).rejects.toThrow(/nothing to read/);
    expect(empty.execute).not.toHaveBeenCalled();
    const full = runner(
      { segments: [], notes: '' },
      { existing: Array.from({ length: 40 }, (_, i) => ({ name: `م${i}` })) },
    );
    await expect(full.r.run(job())).rejects.toThrow(/full/);
  });
});

// ───────────────────────── audiences: the service ─────────────────────────

describe('SegmentsService: confirm and propose', () => {
  const row = (over: Record<string, unknown> = {}) => ({
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
    note: '',
    isActive: false,
    sortOrder: 0,
    source: 'AI',
    verified: false,
    evidence: 'نقل',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    offerings: [],
    ...over,
  });

  function setup(opts: { row?: unknown; material?: number; facts?: number; refs?: number; count?: number; running?: boolean } = {}) {
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => row({ ...(opts.row as object), ...data }));
    const prisma = {
      businessSegment: {
        findUnique: async () => (opts.row === null ? null : (opts.row ?? row())),
        update,
        count: async () => opts.count ?? 0,
      },
      businessSection: { count: async () => opts.material ?? 1 },
      businessFact: { count: async () => opts.facts ?? 0 },
      businessReference: { count: async () => opts.refs ?? 0 },
      aiJob: { findFirst: async () => (opts.running ? { id: 'j0' } : null) },
    };
    const jobs = { enqueue: vi.fn(async (_j: unknown) => ({ id: 'job1' })) };
    const audit = { log: vi.fn() };
    const svc = new SegmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      jobs as unknown as AiJobsService,
    );
    return { svc, update, jobs, audit };
  }

  it('confirm makes a proposed audience used, and shows where it came from', async () => {
    const { svc, update, audit } = setup();
    const out = await svc.confirm('s1', user);
    expect(update.mock.calls[0]![0].data).toMatchObject({ verified: true, isActive: true });
    expect(out).toMatchObject({ source: 'AI', verified: true, evidence: 'نقل' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'business.segment_confirm' }));
  });

  it('will not switch on a proposal nobody has confirmed, but lets it be edited', async () => {
    const { svc } = setup();
    await expect(svc.update('s1', { isActive: true }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('s1', { summary: 'ویرایش' }, user)).resolves.toBeTruthy();
    await expect(setup({ row: null }).svc.confirm('zz', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an audience the admin typed can be switched on and off freely', async () => {
    const { svc } = setup({ row: row({ source: 'ADMIN', verified: true, isActive: false }) });
    await expect(svc.update('s1', { isActive: true }, user)).resolves.toBeTruthy();
  });

  it('queues a proposal only when there is something to read, none is running and there is room', async () => {
    const ok = setup();
    await expect(ok.svc.propose('b1', user)).resolves.toEqual({ jobId: 'job1' });
    expect(ok.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BUSINESS_SEGMENTS_PROPOSE', targetType: 'Business', targetId: 'b1' }),
    );
    await expect(setup({ running: true }).svc.propose('b1', user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ material: 0 }).svc.propose('b1', user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ material: 0, facts: 2 }).svc.propose('b1', user)).resolves.toEqual({ jobId: 'job1' });
    await expect(setup({ count: 40 }).svc.propose('b1', user)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ───────────────────────── variants of a line ─────────────────────────

describe('variants of one line (BUSINESS_OFFERINGS_EXTRACT with a parent)', () => {
  const SERVICES = '- تسهیلات ویپاد شامل انواع زیر است\n- تسهیلات تجهیزات برای خرید دستگاه\n- تسهیلات مسکن برای خرید خانه';
  const existingRows = [
    { id: 'L', parentId: null, name: 'تسهیلات ویپاد', aliases: [], summary: 'خط محصول', features: [] },
    { id: 'V', parentId: 'L', name: 'گونه', aliases: [], summary: '', features: [] },
    { id: 'G', parentId: 'V', name: 'زیرگونه', aliases: [], summary: '', features: [] },
  ];

  function runner(data: unknown, rows = existingRows) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      business: { findUnique: async () => baseBusiness([{ key: 'SERVICES', content: SERVICES }]) },
      businessOffering: {
        findMany: async () => rows,
        create: async ({ data: d }: { data: Record<string, unknown> }) => {
          created.push(d);
          return d;
        },
      },
      businessFact: { findMany: async () => [] },
      businessReference: { findMany: async () => [] },
    };
    const execute = vi.fn(async (_args: unknown) => ({
      data,
      model: 'm',
      usage,
      prompt: { key: 'business_offerings_extract', version: 1 },
    }));
    const r = new BusinessOfferingsExtractRunner(prisma as unknown as PrismaService, { execute } as unknown as AiExecutor);
    return { r, created, execute };
  }
  const proposal = (over: Record<string, unknown> = {}) => ({
    name: 'تسهیلات تجهیزات',
    aliases: [],
    kind: 'SERVICE',
    summary: '',
    features: [],
    priceAmount: '',
    priceCurrency: 'NONE',
    priceFrom: false,
    priceUnit: '',
    evidence: 'تسهیلات تجهیزات برای خرید دستگاه',
    ...over,
  });

  it('asks only for the variants of that line, and saves each under it', async () => {
    const { r, created, execute } = runner({ offerings: [proposal()], notes: '' });
    await r.run(job({ parentId: 'L' }));
    expect(created[0]).toMatchObject({ name: 'تسهیلات تجهیزات', parentId: 'L', source: 'AI', verified: false, isActive: false });
    const vars = (execute.mock.calls[0]![0] as { vars: Record<string, string> }).vars;
    expect(vars.scope).toContain('Only the VARIANTS of "تسهیلات ویپاد"');
    expect(vars.scope).toContain('About it: خط محصول');
  });

  it('without a parent it asks for the whole business and saves top-level rows, as before', async () => {
    const { r, created, execute } = runner({ offerings: [proposal()], notes: '' });
    await r.run(job());
    expect(created[0]).toMatchObject({ parentId: null });
    expect((execute.mock.calls[0]![0] as { vars: Record<string, string> }).vars.scope).toBe(
      '(all offerings of the business)',
    );
  });

  it('refuses a line that is gone or has no level left, before calling the model', async () => {
    const gone = runner({ offerings: [], notes: '' });
    await expect(gone.r.run(job({ parentId: 'nope' }))).rejects.toThrow(/no longer exists/);
    const deep = runner({ offerings: [], notes: '' });
    await expect(deep.r.run(job({ parentId: 'G' }))).rejects.toThrow(/at most 3 levels/);
    expect(gone.execute).not.toHaveBeenCalled();
    expect(deep.execute).not.toHaveBeenCalled();
  });

  it('proposes at most a dozen variants at a time', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `تسهیلات نوع ${i + 1}`);
    const created: Record<string, unknown>[] = [];
    const prisma = {
      business: { findUnique: async () => baseBusiness([{ key: 'SERVICES', content: names.map((n) => `- ${n} برای شما`).join('\n') }]) },
      businessOffering: {
        findMany: async () => [existingRows[0]!],
        create: async ({ data: d }: { data: Record<string, unknown> }) => {
          created.push(d);
          return d;
        },
      },
      businessFact: { findMany: async () => [] },
      businessReference: { findMany: async () => [] },
    };
    const data = { offerings: names.map((n) => proposal({ name: n, evidence: `${n} برای شما` })), notes: '' };
    const execute = vi.fn(async (_a: unknown) => ({ data, model: 'm', usage, prompt: { key: 'k', version: 1 } }));
    const r = new BusinessOfferingsExtractRunner(prisma as unknown as PrismaService, { execute } as unknown as AiExecutor);
    const out = await r.run(job({ parentId: 'L' }));
    expect(created).toHaveLength(12);
    expect(out.output).toMatchObject({ saved: 12, dropped: 8 });
  });
});

describe('OfferingsService.extract for a line (docs/73)', () => {
  function setup(rows: { id: string; parentId: string | null }[]) {
    const prisma = {
      businessSection: { count: async () => 1 },
      businessFact: { count: async () => 0 },
      businessReference: { count: async () => 0 },
      businessOffering: { count: async () => rows.length, findMany: async () => rows },
      aiJob: { findFirst: async () => null },
    };
    const jobs = { enqueue: vi.fn(async (_j: unknown) => ({ id: 'job1' })) };
    const svc = new OfferingsService(
      prisma as unknown as PrismaService,
      { log: vi.fn() } as unknown as AuditService,
      jobs as unknown as AiJobsService,
    );
    return { svc, jobs };
  }

  it('queues the job with the line, and refuses a line that cannot take variants', async () => {
    const { svc, jobs } = setup([
      { id: 'L', parentId: null },
      { id: 'V', parentId: 'L' },
      { id: 'G', parentId: 'V' },
    ]);
    await expect(svc.extract('b1', user, { parentId: 'L' })).resolves.toEqual({ jobId: 'job1' });
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ input: { parentId: 'L' } }));
    await expect(svc.extract('b1', user, { parentId: 'G' })).rejects.toThrow(/3 levels/);
    await expect(svc.extract('b1', user, { parentId: 'elsewhere' })).rejects.toThrow(/same business/);
  });

  it('without a line it works as before', async () => {
    const { svc, jobs } = setup([]);
    await svc.extract('b1', user);
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ input: {} }));
  });
});
