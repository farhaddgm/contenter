import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_OFFERING_LIMIT,
  CreateBusinessOfferingSchema,
  nextPersianMonth,
  normalizeMonths,
  UpdateBusinessOfferingSchema,
  peakingSoon,
  persianMonthOf,
} from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { AuditService } from '../audit/audit.service';
import {
  buildBusinessParts,
  formatBusiness,
  formatBusinessCatalog,
  type BusinessForPrompt,
  type OfferingForPrompt,
} from '../ai/context';
import type { AiExecutor } from '../ai/ai-executor.service';
import { BusinessOfferingsExtractRunner } from '../ai/runners/business-offerings.runner';
import { OfferingsService } from './offerings.service';
import { BusinessApi } from './business-api';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;
const NOW = new Date('2026-10-22T10:00:00Z');

const offering = (over: Partial<OfferingForPrompt> = {}): OfferingForPrompt => ({
  name: 'اشتراک طلایی',
  aliases: [],
  kind: 'PLAN',
  status: 'ACTIVE',
  push: 2,
  summary: '',
  features: [],
  priceAmount: '199000',
  priceCurrency: 'IRT',
  priceFrom: false,
  priceUnit: 'ماهانه',
  priceValidUntil: null,
  availableFrom: null,
  availableUntil: null,
  ...over,
});

const base: BusinessForPrompt = {
  name: 'Acme',
  tagline: '',
  industry: '',
  website: '',
  location: '',
  language: 'fa',
  sections: [{ key: 'OVERVIEW', content: 'We sell tea.' }],
};

describe('[CATALOG] block', () => {
  it('is empty without offerings, and the prompt is byte-for-byte the same as before', () => {
    expect(formatBusinessCatalog([], NOW)).toBe('');
    const plain = formatBusiness(base);
    expect(formatBusiness({ ...base, offerings: [] })).toBe(plain);
    expect(plain).not.toContain('[CATALOG]');
  });

  it('prints a valid price exactly, with its unit and validity, and the instructions', () => {
    const out = formatBusinessCatalog(
      [offering({ priceValidUntil: '2026-11-30', features: ['پشتیبانی', 'مشاوره'], aliases: ['Gold'] })],
      NOW,
    );
    expect(out).toContain('### Offerings [CATALOG]');
    expect(out).toContain('- [PLAN · push 2] اشتراک طلایی — 199,000 تومان / ماهانه (valid until 2026-11-30)');
    expect(out).toContain('Also written: Gold');
    expect(out).toContain('Features: پشتیبانی; مشاوره');
    expect(out).toMatch(/Never promote an item marked NOT AVAILABLE/);
  });

  it('does not print an expired price, and says so', () => {
    const out = formatBusinessCatalog([offering({ priceValidUntil: '2026-10-01' })], NOW);
    expect(out).toContain('price not available');
    expect(out).not.toContain('199,000');
  });

  it('lists what cannot be sold as NOT AVAILABLE, without its features', () => {
    const out = formatBusinessCatalog(
      [
        offering({ name: 'متوقف', status: 'PAUSED', features: ['secret feature'] }),
        offering({ name: 'فصلی', status: 'SEASONAL', availableUntil: '2026-09-30', features: ['old'] }),
      ],
      NOW,
    );
    expect(out).toContain('NOT AVAILABLE] متوقف');
    expect(out).toContain('NOT AVAILABLE] فصلی');
    expect(out).not.toContain('secret feature');
    expect(out).not.toContain('Features: old');
  });

  it('marks an offering the admin does not want pushed', () => {
    expect(formatBusinessCatalog([offering({ push: 0 })], NOW)).toContain('do not promote');
  });

  it('accepts the decimal object of the database driver', () => {
    const out = formatBusinessCatalog([offering({ priceAmount: new Prisma.Decimal('1990000.5') })], NOW);
    expect(out).toContain('1,990,000.5 تومان');
  });

  it('comes right after [FACTS] and before the terminology, as its own block of the preview', () => {
    const ids = buildBusinessParts({
      ...base,
      facts: [{ label: 'x', value: 'y', category: 'OTHER', verified: true, validUntil: null }],
      terms: [{ term: 't', kind: 'USE', alternatives: [], note: '' }],
      offerings: [offering()],
    }).map((p) => p.id);
    expect(ids).toEqual(['HEAD', 'SECTION:OVERVIEW', 'FACTS', 'CATALOG', 'TERMS']);
  });

  it('is cut within its budget and says how many rows were left out', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      offering({ name: `محصول ${i}`, summary: 'توضیح '.repeat(30), features: ['ویژگی بلند '.repeat(8)] }),
    );
    const part = buildBusinessParts({ ...base, offerings: many }).find((p) => p.id === 'CATALOG');
    expect(part?.cut).toBe(true);
    expect(part?.omitted).toBeGreaterThan(0);
  });
});

function setup(
  opts: {
    count?: number;
    clash?: boolean;
    row?: Record<string, unknown> | null;
    business?: boolean;
    running?: boolean;
    material?: { services?: number; facts?: number; references?: number };
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const row = {
    id: 'o1',
    businessId: 'b1',
    name: 'اشتراک طلایی',
    aliases: [],
    kind: 'PLAN',
    status: 'ACTIVE',
    push: 1,
    summary: '',
    features: [],
    priceAmount: new Prisma.Decimal('199000'),
    priceCurrency: 'IRT',
    priceFrom: false,
    priceUnit: '',
    priceValidUntil: null,
    availableFrom: null,
    availableUntil: null,
    url: '',
    note: 'internal',
    source: 'ADMIN',
    verified: true,
    isActive: true,
    evidence: '',
    sortOrder: 0,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    ...(opts.row ?? {}),
  };
  const prisma = {
    business: { findUnique: async () => (opts.business === false ? null : { id: 'b1' }) },
    businessOffering: {
      count: async () => opts.count ?? 0,
      findFirst: async () => (opts.clash ? { id: 'other' } : null),
      findUnique: async () => (opts.row === null ? null : row),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { ...row, ...data, id: 'new', createdAt: row.createdAt, updatedAt: row.updatedAt };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return { ...row, ...data };
      },
      delete: vi.fn(),
    },
    businessSection: { count: async () => opts.material?.services ?? 1 },
    businessFact: { count: async () => opts.material?.facts ?? 0 },
    businessReference: { count: async () => opts.material?.references ?? 0 },
    aiJob: { findFirst: async () => (opts.running ? { id: 'j0' } : null) },
  };
  const audit = { log: vi.fn() };
  const jobs = { enqueue: vi.fn(async () => ({ id: 'job1' })) };
  const svc = new OfferingsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    jobs as unknown as AiJobsService,
  );
  return { svc, created, updated, audit, jobs, prisma };
}

describe('OfferingsService', () => {
  it('creates an active, verified row typed by the admin, with the price as a decimal', async () => {
    const { svc, created, audit } = setup();
    const out = await svc.create(
      'b1',
      { name: 'کارت', priceAmount: '۱۹۹٬۰۰۰', priceCurrency: 'IRT', priceValidUntil: '2026-12-01' },
      user,
    );
    expect(created[0]).toMatchObject({
      businessId: 'b1',
      name: 'کارت',
      priceAmount: '199000',
      priceCurrency: 'IRT',
      source: 'ADMIN',
      verified: true,
      isActive: true,
    });
    expect((created[0]!.priceValidUntil as Date).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(out.priceAmount).toBe('199000');
    // the internal note never goes to the audit log
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('internal');
  });

  it('drops the price details when there is no price', async () => {
    const { svc, created } = setup();
    await svc.create('b1', { name: 'مشاوره', priceFrom: true, priceUnit: 'ساعتی' }, user);
    expect(created[0]).toMatchObject({ priceAmount: null, priceCurrency: null, priceFrom: false, priceUnit: '' });
  });

  it('refuses a duplicate name, a full catalog, a missing business and a price without currency', async () => {
    await expect(setup({ clash: true }).svc.create('b1', { name: 'x' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      setup({ count: BUSINESS_OFFERING_LIMIT }).svc.create('b1', { name: 'x' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ business: false }).svc.create('b1', { name: 'x' }, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(setup().svc.create('b1', { name: 'x', priceAmount: '100' }, user)).rejects.toThrow();
  });

  it('checks the rules on the row as it will be, not only on the fields sent', async () => {
    const { svc } = setup();
    // the row has a price in IRT; clearing the amount while keeping the currency is a problem
    await expect(svc.update('o1', { priceCurrency: 'USD' }, user)).resolves.toMatchObject({
      priceCurrency: 'USD',
    });
    await expect(svc.update('o1', { priceAmount: '' }, user)).resolves.toMatchObject({ priceAmount: null });
    await expect(
      svc.update('o1', { availableFrom: '2026-12-01', availableUntil: '2026-11-01' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('changes only what is sent and clears the price details with the price', async () => {
    const { svc, updated } = setup({ row: { priceFrom: true, priceUnit: 'ماهانه' } });
    await svc.update('o1', { push: 3 }, user);
    expect(updated[0]).toMatchObject({ push: 3, priceAmount: '199000', priceFrom: true, priceUnit: 'ماهانه' });
    await svc.update('o1', { priceAmount: null, priceCurrency: null }, user);
    expect(updated[1]).toMatchObject({ priceAmount: null, priceCurrency: null, priceFrom: false, priceUnit: '' });
  });

  it('does not switch on a row the admin has not confirmed', async () => {
    const { svc } = setup({ row: { verified: false, isActive: false, source: 'AI' } });
    await expect(svc.update('o1', { isActive: true }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('o1', { summary: 'edited' }, user)).resolves.toBeTruthy();
  });

  it('confirm makes an AI row used', async () => {
    const { svc, updated } = setup({ row: { verified: false, isActive: false, source: 'AI' } });
    await svc.confirm('o1', user);
    expect(updated[0]).toMatchObject({ verified: true, isActive: true });
  });

  it('answers 404 for a missing row', async () => {
    await expect(setup({ row: null }).svc.update('zz', { push: 1 }, user)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ row: null }).svc.remove('zz', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('queues the extraction only when there is something to read and none is running', async () => {
    const ok = setup();
    await expect(ok.svc.extract('b1', user)).resolves.toEqual({ jobId: 'job1' });
    expect(ok.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BUSINESS_OFFERINGS_EXTRACT', targetType: 'Business', targetId: 'b1' }),
    );
    await expect(setup({ running: true }).svc.extract('b1', user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ material: { services: 0, facts: 0, references: 0 } }).svc.extract('b1', user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ count: BUSINESS_OFFERING_LIMIT }).svc.extract('b1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('BusinessApi.offeringsForQuality', () => {
  it('reads only active, confirmed rows and turns them into quality rules', async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      offering({ name: 'متوقف', status: 'PAUSED', priceAmount: new Prisma.Decimal('100') }),
    ]);
    const api = new BusinessApi({ businessOffering: { findMany } } as unknown as PrismaService);
    const rules = await api.offeringsForQuality('b1', NOW);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'b1', isActive: true, verified: true } }),
    );
    expect(rules).toEqual([
      expect.objectContaining({ name: 'متوقف', priceAmount: '100', available: false }),
    ]);
  });
});

describe('BusinessOfferingsExtractRunner', () => {
  const SERVICES = '- اشتراک طلایی ماهانه ۱۹۹ هزار تومان است\n- مشاوره رایگان';

  function runner(data: unknown, opts: { existing?: { name: string; aliases: string[] }[]; services?: string } = {}) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      business: {
        findUnique: async () => ({
          ...base,
          id: 'b1',
          sections: [{ key: 'SERVICES', content: opts.services ?? SERVICES, source: 'ADMIN', reviewedAt: null }],
          facts: [],
          terms: [],
          assets: [],
          offerings: [],
        }),
      },
      businessOffering: {
        findMany: async () => opts.existing ?? [],
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
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      prompt: { key: 'business_offerings_extract', version: 1 },
    }));
    const r = new BusinessOfferingsExtractRunner(
      prisma as unknown as PrismaService,
      { execute } as unknown as AiExecutor,
    );
    return { r, created, execute };
  }

  const proposal = (over: Record<string, unknown> = {}) => ({
    name: 'اشتراک طلایی',
    aliases: [],
    kind: 'PLAN',
    summary: '',
    features: [],
    priceAmount: '199000',
    priceCurrency: 'IRT',
    priceFrom: false,
    priceUnit: 'ماهانه',
    evidence: 'اشتراک طلایی ماهانه ۱۹۹ هزار تومان',
    ...over,
  });
  const job = { id: 'j1', targetId: 'b1' } as never;

  it('saves a backed row as an inactive, unverified AI row, with the sources it was given', async () => {
    const { r, created, execute } = runner({ offerings: [proposal()], notes: '' });
    const out = await r.run(job);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      businessId: 'b1',
      name: 'اشتراک طلایی',
      priceAmount: '199000',
      priceCurrency: 'IRT',
      source: 'AI',
      verified: false,
      isActive: false,
      jobId: 'j1',
    });
    expect(out.output).toMatchObject({ saved: 1, dropped: 0 });
    const vars = (execute.mock.calls[0]![0] as { vars: Record<string, string> }).vars;
    expect(vars.sources).toContain('[S1] Products & services section');
    expect(vars.sources).toContain('اشتراک طلایی ماهانه');
  });

  it('discards rows whose quote the sources do not contain, and keeps a row without an unbacked price', async () => {
    const { r, created } = runner({
      offerings: [
        proposal({ name: 'ساختگی', evidence: 'این در منبع نیست' }),
        proposal({ name: 'مشاوره', evidence: 'مشاوره رایگان', priceAmount: '50000', priceCurrency: 'IRT' }),
      ],
      notes: '',
    });
    const out = await r.run(job);
    expect(created.map((c) => c.name)).toEqual(['مشاوره']);
    expect(created[0]).toMatchObject({ priceAmount: null, priceCurrency: null });
    expect(out.output).toMatchObject({ saved: 1, dropped: 1, priceDropped: 1 });
  });

  it('skips what is already in the catalog', async () => {
    const { r, created } = runner(
      { offerings: [proposal()], notes: '' },
      { existing: [{ name: 'اشتراک طلایی', aliases: [] }] },
    );
    await r.run(job);
    expect(created).toEqual([]);
  });

  it('stops with a clear error when there is nothing to read', async () => {
    const { r, execute } = runner({ offerings: [], notes: '' }, { services: '' });
    await expect(r.run(job)).rejects.toThrow(/nothing to read/);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('selling points: feature → benefit → proof (docs/67 §4.9)', () => {
  it('adds no line and keeps the bytes unchanged without claims', () => {
    const plain = formatBusinessCatalog([offering()]);
    expect(formatBusinessCatalog([offering({ claims: [] })])).toBe(plain);
    expect(plain).not.toContain('Selling points');
  });

  it('tells the model which points have proof and which do not', () => {
    const out = formatBusinessCatalog([
      offering({
        claims: [
          { feature: 'ارسال سریع', benefit: 'کالا فردا می‌رسد', proof: 'میانگین ۱٫۲ روز در ۱۴۰۴' },
          { feature: 'ضمانت بازگشت', benefit: '', proof: '' },
        ],
      }),
    ]);
    expect(out).toContain('Selling points:');
    expect(out).toContain('- ارسال سریع → کالا فردا می‌رسد (proof: میانگین ۱٫۲ روز در ۱۴۰۴)');
    expect(out).toContain('- ضمانت بازگشت (no proof — do not state as certain)');
  });

  it('ignores malformed stored JSON instead of failing the prompt', () => {
    expect(formatBusinessCatalog([offering({ claims: 'oops' })])).not.toContain('Selling points');
  });

  it('hides the claims of an offering that cannot be sold today', () => {
    const out = formatBusinessCatalog([
      offering({ status: 'PAUSED', claims: [{ feature: 'x', benefit: '', proof: '' }] }),
    ]);
    expect(out).toContain('NOT AVAILABLE');
    expect(out).not.toContain('Selling points');
  });
});

describe('OfferingsService claims', () => {
  it('stores the claims on create and returns them parsed', async () => {
    const { svc, created } = setup();
    await svc.create('b1', { name: 'کارت', claims: [{ feature: 'سریع', proof: 'آمار' }] }, user);
    expect(created[0]).toMatchObject({ claims: [{ feature: 'سریع', benefit: '', proof: 'آمار' }] });
  });

  it('refuses more than the limit and empty features', async () => {
    const { svc } = setup();
    const many = Array.from({ length: 9 }, (_, i) => ({ feature: `f${i}` }));
    await expect(svc.create('b1', { name: 'x', claims: many }, user)).rejects.toThrow();
    await expect(svc.create('b1', { name: 'x', claims: [{ feature: ' ' }] }, user)).rejects.toThrow();
  });
});

describe('lifecycle: stock, peak season, related offerings (docs/67 §4.10)', () => {
  // 2026-10-22 is 30 Mehr 1405 (month 7); 2026-10-23 is 1 Aban (month 8)
  const MEHR = new Date('2026-10-22T10:00:00Z');
  const ABAN = new Date('2026-10-23T10:00:00Z');

  it('reads the Persian month with Intl', () => {
    expect(persianMonthOf(MEHR)).toBe(7);
    expect(persianMonthOf(ABAN)).toBe(8);
    expect(persianMonthOf(new Date('2027-03-21T10:00:00Z'))).toBe(1);
    expect(nextPersianMonth(12)).toBe(1);
  });

  it('changes nothing in the prompt while the new fields are unset', () => {
    const plain = formatBusinessCatalog([offering()], MEHR);
    expect(
      formatBusinessCatalog(
        [offering({ stock: 'IN_STOCK', peakMonths: [], complementIds: [], substituteIds: [] })],
        MEHR,
      ),
    ).toBe(plain);
  });

  it('tags low stock and the peak season, and lists complements', () => {
    const out = formatBusinessCatalog(
      [
        offering({ id: 'a', name: 'الف', stock: 'LOW', peakMonths: [8], complementIds: ['b'] }),
        offering({ id: 'b', name: 'ب' }),
      ],
      ABAN,
    );
    expect(out).toContain('LOW STOCK · PEAK SEASON NOW');
    expect(out).toContain('Pairs well with: ب');
    expect(formatBusinessCatalog([offering({ id: 'a', peakMonths: [8] })], MEHR)).not.toContain('PEAK SEASON');
  });

  it('treats OUT as not available and names the available substitutes only', () => {
    const out = formatBusinessCatalog(
      [
        offering({ id: 'a', name: 'الف', stock: 'OUT', substituteIds: ['b', 'c'], features: ['x'] }),
        offering({ id: 'b', name: 'ب' }),
        offering({ id: 'c', name: 'ج', status: 'PAUSED' }),
      ],
      MEHR,
    );
    expect(out).toContain('NOT AVAILABLE] الف');
    expect(out).toContain('Instead offer: ب');
    expect(out).not.toContain('Instead offer: ب | ج');
    expect(out).not.toContain('Features: x');
  });

  it('lists offerings whose peak begins next month, only if they can be sold', () => {
    const rows = [
      { peakMonths: [8], status: 'ACTIVE', stock: 'IN_STOCK', availableFrom: null, availableUntil: null },
      { peakMonths: [7, 8], status: 'ACTIVE', stock: 'IN_STOCK', availableFrom: null, availableUntil: null },
      { peakMonths: [8], status: 'PAUSED', stock: 'IN_STOCK', availableFrom: null, availableUntil: null },
      { peakMonths: [8], status: 'ACTIVE', stock: 'OUT', availableFrom: null, availableUntil: null },
      { peakMonths: [], status: 'ACTIVE', stock: 'IN_STOCK', availableFrom: null, availableUntil: null },
    ];
    expect(peakingSoon(rows, MEHR)).toEqual([rows[0]]);
  });

  it('checks that related offerings belong to the same business and are not the row itself', async () => {
    const { svc, prisma } = setup();
    (prisma.businessOffering as { count: () => Promise<number> }).count = async () => 0;
    await expect(svc.create('b1', { name: 'x', complementIds: ['nope'] }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('o1', { substituteIds: ['o1'] }, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps months unique and sorted, and an update that omits them leaves them alone', () => {
    expect(normalizeMonths([9, 2, 9])).toEqual([2, 9]);
    expect(UpdateBusinessOfferingSchema.parse({ push: 2 })).toEqual({ push: 2 });
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x', peakMonths: [13] }).success).toBe(false);
  });
});
