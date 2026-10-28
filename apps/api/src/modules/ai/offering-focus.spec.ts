import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FocusForPrompt } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { AccessService } from '../../common/access';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { BusinessApi } from '../businesses/business-api';
import { ContentsService } from '../contents/contents.module';
import { TopicsService } from '../topics/topics.module';
import {
  buildBusinessParts,
  formatBusiness,
  formatBusinessFocus,
  type BusinessForPrompt,
  type OfferingForPrompt,
} from './context';
import { ContextLoader } from './context-loader.service';

const NOW = new Date('2026-10-28T10:00:00Z');
const user = { id: 'u1', role: 'ADMIN' } as AuthUser;

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

const segment = (over: Partial<FocusForPrompt['segments'][number]> = {}) => ({
  kind: 'PERSONA' as const,
  name: 'کارمند',
  summary: 'حقوق‌بگیر ۳۰ ساله',
  goals: ['خرید لپ‌تاپ'],
  pains: ['وثیقه'],
  objections: ['سود بالا'],
  channels: ['اینستاگرام'],
  messageAngle: 'بدون وثیقه',
  ...over,
});

const focus = (over: Partial<FocusForPrompt> = {}): FocusForPrompt => ({
  chain: [
    offering({ id: 'l', name: 'تسهیلات ویپاد', summary: 'خط محصول', guardrails: ['سود تضمینی'] }),
    offering({ id: 'v', name: 'تسهیلات تجهیزات', parentId: 'l', features: ['۱۲ ماهه'] }),
  ],
  siblings: ['تسهیلات مسکن', 'تسهیلات خودرو'],
  segments: [segment()],
  segmentChosen: true,
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

describe('[FOCUS] block (docs/73 §4)', () => {
  it('is empty without a focus, and the prompt is byte-for-byte the same as before', () => {
    expect(formatBusinessFocus(null)).toBe('');
    expect(formatBusinessFocus(undefined)).toBe('');
    expect(formatBusinessFocus(focus({ chain: [], segments: [] }))).toBe('');
    const plain = formatBusiness(base);
    expect(formatBusiness({ ...base, focus: null })).toBe(plain);
    expect(plain).not.toContain('[FOCUS]');
  });

  it('names the offering with its line, its neighbours and its never-say phrases', () => {
    const out = formatBusinessFocus(focus(), NOW);
    expect(out).toContain('### Focus [FOCUS]');
    expect(out).toContain('This piece is about one offering and one audience.');
    expect(out).toContain('Offering: تسهیلات ویپاد > تسهیلات تجهیزات');
    // the line first, the variant indented under it, with what it belongs to
    expect(out.indexOf('تسهیلات ویپاد\n')).toBeLessThan(out.indexOf('  - [SERVICE] تسهیلات تجهیزات'));
    expect(out).toContain('    Part of: تسهیلات ویپاد');
    expect(out).toContain('    Never say: سود تضمینی');
    expect(out).toContain('Other offerings next to it (do not mix their terms in): تسهیلات مسکن | تسهیلات خودرو');
    expect(out).toMatch(/never give it the price, terms or features of another offering/);
  });

  it('prints the audience in full', () => {
    const out = formatBusinessFocus(focus(), NOW);
    expect(out).toContain('Audience:\n- [PERSONA] کارمند');
    expect(out).toContain('  Who: حقوق‌بگیر ۳۰ ساله');
    expect(out).toContain('  Goals: خرید لپ‌تاپ');
    expect(out).toContain('  Pains: وثیقه');
    expect(out).toContain('  Objections: سود بالا');
    expect(out).toContain('  Channels: اینستاگرام');
    expect(out).toContain('  What convinces them: بدون وثیقه');
  });

  it('says whose audiences they are when the admin did not choose one, and leaves out empty lines', () => {
    const out = formatBusinessFocus(
      focus({
        segmentChosen: false,
        segments: [segment({ goals: [], channels: [], summary: '', messageAngle: '' })],
      }),
      NOW,
    );
    expect(out).toContain('Audiences of this offering, main first:');
    expect(out).not.toContain('Goals:');
    expect(out).not.toContain('Who:');
    expect(out).not.toContain('What convinces');
  });

  it('works with an audience alone or an offering alone', () => {
    const onlyAudience = formatBusinessFocus(focus({ chain: [], siblings: [] }), NOW);
    expect(onlyAudience).toContain('This piece is about one audience.');
    expect(onlyAudience).not.toContain('Offering:');
    const onlyOffering = formatBusinessFocus(focus({ segments: [] }), NOW);
    expect(onlyOffering).toContain('This piece is about one offering.');
    expect(onlyOffering).not.toContain('Audience');
  });

  it('sits right after [CATALOG] and before the terminology, as its own block of the preview', () => {
    const ids = buildBusinessParts({
      ...base,
      facts: [{ label: 'x', value: 'y', category: 'OTHER', verified: true, validUntil: null }],
      offerings: [offering()],
      terms: [{ term: 't', kind: 'USE', alternatives: [], note: '' }],
      focus: focus(),
    }).map((p) => p.id);
    expect(ids).toEqual(['HEAD', 'SECTION:OVERVIEW', 'FACTS', 'CATALOG', 'FOCUS', 'TERMS']);
  });

  it('is cut within its budget', () => {
    const long = Array.from({ length: 3 }, (_, i) =>
      segment({ name: `مخاطب ${i}`, summary: 'توضیح '.repeat(200), pains: ['درد بلند '.repeat(20)] }),
    );
    const part = buildBusinessParts({ ...base, focus: focus({ segments: long }) }).find((p) => p.id === 'FOCUS');
    expect(part?.cut).toBe(true);
    expect(part?.omitted).toBeGreaterThan(0);
  });
});

describe('ContextLoader: the focus of a job', () => {
  function setup(topic: { offeringId: string | null; segmentId: string | null }, content?: unknown) {
    const focusForPrompt = vi.fn(async (_b: string, f: unknown) => ({ ...focus(), asked: f }));
    const prisma = {
      topic: {
        findUniqueOrThrow: async () => ({ businessId: 'b1', samplesSkippedAt: new Date(), styleId: null, ...topic }),
      },
      content: { findUnique: vi.fn(async () => content ?? null) },
      sampleContent: { count: async () => 0 },
    };
    const businesses = {
      promptProfile: async () => ({ ...base }),
      readableReferences: async () => [],
      focusForPrompt,
    };
    const ctx = new ContextLoader(prisma as unknown as PrismaService, businesses as unknown as BusinessApi);
    return { ctx, focusForPrompt, prisma };
  }

  it('adds no focus unless the job asks for it (profile building, learning from edits)', async () => {
    const { ctx, focusForPrompt } = setup({ offeringId: 'o1', segmentId: null });
    expect(await ctx.business('t1')).not.toHaveProperty('focus');
    expect(focusForPrompt).not.toHaveBeenCalled();
  });

  it("uses the project's offering and audience", async () => {
    const { ctx, focusForPrompt, prisma } = setup({ offeringId: 'o1', segmentId: 's1' });
    const out = await ctx.business('t1', undefined, { focus: true });
    expect(focusForPrompt).toHaveBeenCalledWith('b1', { offeringId: 'o1', segmentId: 's1' });
    expect(out).toHaveProperty('focus');
    expect(prisma.content.findUnique).not.toHaveBeenCalled();
  });

  it("lets a content's own choice win and fills the rest from the project", async () => {
    const { ctx, focusForPrompt } = setup(
      { offeringId: 'o1', segmentId: 's1' },
      { offeringId: 'o2', segmentId: null },
    );
    await ctx.business('t1', undefined, { focus: { contentId: 'c1' } });
    expect(focusForPrompt).toHaveBeenCalledWith('b1', { offeringId: 'o2', segmentId: 's1' });
  });

  it('adds nothing when the business reports no usable focus', async () => {
    const { ctx, focusForPrompt } = setup({ offeringId: null, segmentId: null });
    focusForPrompt.mockResolvedValueOnce(null as never);
    expect(await ctx.business('t1', undefined, { focus: true })).not.toHaveProperty('focus');
  });
});

describe('BusinessApi.focusForPrompt', () => {
  const core = (id: string, name: string, parentId: string | null = null) => ({
    ...offering({ id, name, parentId }),
    stock: 'IN_STOCK',
  });
  function api(opts: { segmentRow?: unknown; links?: unknown[]; rows?: ReturnType<typeof core>[] } = {}) {
    const rows = opts.rows ?? [core('l', 'خط'), core('v', 'گونه ۱', 'l'), core('w', 'گونه ۲', 'l'), core('x', 'مستقل')];
    const prisma = {
      businessOffering: { findMany: vi.fn(async () => rows) },
      businessSegment: { findFirst: vi.fn(async () => opts.segmentRow ?? null) },
      offeringSegment: { findMany: vi.fn(async () => opts.links ?? []) },
    };
    return { api: new BusinessApi(prisma as unknown as PrismaService), prisma };
  }
  const seg = (name: string) => ({
    kind: 'PERSONA',
    name,
    summary: '',
    goals: [],
    pains: [],
    objections: [],
    channels: [],
    messageAngle: '',
  });

  it('is null without a focus, and reads nothing', async () => {
    const { api: a, prisma } = api();
    expect(await a.focusForPrompt('b1', {})).toBeNull();
    expect(await a.focusForPrompt('b1', { offeringId: null, segmentId: null })).toBeNull();
    expect(prisma.businessOffering.findMany).not.toHaveBeenCalled();
  });

  it('gives the line above the offering, its neighbours under the same line, and nothing else', async () => {
    const { api: a } = api();
    const out = await a.focusForPrompt('b1', { offeringId: 'v' });
    expect(out?.chain.map((o) => o.name)).toEqual(['خط', 'گونه ۱']);
    expect(out?.siblings).toEqual(['گونه ۲']);
    expect(out?.segments).toEqual([]);
  });

  it('for a line, the neighbours are the other lines', async () => {
    const { api: a } = api();
    expect((await a.focusForPrompt('b1', { offeringId: 'l' }))?.siblings).toEqual(['مستقل']);
  });

  it('prefers the chosen audience, if it is switched on', async () => {
    const { api: a, prisma } = api({ segmentRow: seg('انتخابی') });
    const out = await a.focusForPrompt('b1', { offeringId: 'v', segmentId: 's1' });
    expect(out?.segmentChosen).toBe(true);
    expect(out?.segments.map((s) => s.name)).toEqual(['انتخابی']);
    expect(prisma.businessSegment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', businessId: 'b1', isActive: true } }),
    );
    expect(prisma.offeringSegment.findMany).not.toHaveBeenCalled();
  });

  it("falls back to the offering's linked audiences, main first and at most three", async () => {
    const link = (id: string, name: string, fit: number) => ({ fit, segment: { id, ...seg(name) } });
    const { api: a } = api({
      links: [link('1', 'ب فرعی', 1), link('2', 'ج اصلی', 2), link('3', 'الف اصلی', 2), link('4', 'د فرعی', 1)],
    });
    const out = await a.focusForPrompt('b1', { offeringId: 'v' });
    expect(out?.segmentChosen).toBe(false);
    expect(out?.segments.map((s) => s.name)).toEqual(['الف اصلی', 'ج اصلی', 'ب فرعی']);
    expect(out?.segments[0]).not.toHaveProperty('id');
  });

  it('is null when the offering is not usable and no audience is left', async () => {
    const { api: a } = api({ rows: [core('x', 'مستقل')] });
    expect(await a.focusForPrompt('b1', { offeringId: 'gone', segmentId: 'zz' })).toBeNull();
  });

  it('keeps the audience when the offering is gone', async () => {
    const { api: a } = api({ rows: [], segmentRow: seg('انتخابی') });
    const out = await a.focusForPrompt('b1', { offeringId: 'gone', segmentId: 's1' });
    expect(out?.chain).toEqual([]);
    expect(out?.segments).toHaveLength(1);
  });
});

describe('TopicsService: focus rules (docs/73)', () => {
  function setup(opts: { offerings?: string[]; segments?: string[] } = {}) {
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({ id: 't1' }));
    const businesses = {
      hasOffering: vi.fn(async (_b: string, id: string) => (opts.offerings ?? ['o1']).includes(id)),
      hasSegment: vi.fn(async (_b: string, id: string) => (opts.segments ?? ['s1']).includes(id)),
      styleForPrompt: vi.fn(),
    };
    const svc = new TopicsService(
      {
        topic: {
          findUnique: async () => ({ businessId: 'b1', styleId: null, offeringId: 'o1', segmentId: 's1' }),
          update,
          create,
        },
        business: { findUnique: async () => ({ id: 'b1' }) },
      } as unknown as PrismaService,
      { log: vi.fn() } as unknown as AuditService,
      { accessTo: async () => 'EDIT', canEditBusiness: async () => true } as unknown as AccessService,
      businesses as unknown as BusinessApi,
    );
    return { svc, update, create, businesses };
  }

  it('accepts an offering and an audience of the same business', async () => {
    const { svc, update } = setup({ offerings: ['o2'], segments: ['s2'] });
    await svc.update('t1', { offeringId: 'o2', segmentId: 's2' }, user);
    expect(update.mock.calls[0]![0].data).toMatchObject({ offeringId: 'o2', segmentId: 's2' });
  });

  it('refuses an offering or an audience of another business', async () => {
    const a = setup({ offerings: [] });
    await expect(a.svc.update('t1', { offeringId: 'o9' }, user)).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ segments: [] });
    await expect(b.svc.update('t1', { segmentId: 's9' }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(a.update).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
  });

  it('null clears them without asking the business', async () => {
    const { svc, update, businesses } = setup();
    await svc.update('t1', { offeringId: null, segmentId: null }, user);
    expect(businesses.hasOffering).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0].data).toMatchObject({ offeringId: null, segmentId: null });
  });

  it('leaves them alone when other fields change', async () => {
    const { svc, update, businesses } = setup();
    await svc.update('t1', { title: 'عنوان تازه' }, user);
    expect(businesses.hasOffering).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0].data).not.toHaveProperty('offeringId');
    expect(update.mock.calls[0]![0].data).not.toHaveProperty('segmentId');
  });

  it("drops them when the business changes and no new ones are given; another business's are refused", async () => {
    const { svc, update } = setup();
    await svc.update('t1', { businessId: 'b2' }, user);
    expect(update.mock.calls[0]![0].data).toMatchObject({ businessId: 'b2', offeringId: null, segmentId: null });
    const other = setup({ offerings: [] });
    await expect(other.svc.update('t1', { businessId: 'b2', offeringId: 'o1' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a new project needs a business before it can have a focus', async () => {
    const { svc, create } = setup();
    await expect(
      svc.create({ title: 'پروژه', description: 'یک توضیح به اندازهٔ کافی', offeringId: 'o1' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    await svc.create(
      { title: 'پروژه', description: 'یک توضیح به اندازهٔ کافی', businessId: 'b1', offeringId: 'o1' },
      user,
    );
    expect(create).toHaveBeenCalled();
  });
});

describe('ContentsService.update: focus rules (docs/73)', () => {
  function setup(opts: { businessId?: string | null; offerings?: string[]; segments?: string[] } = {}) {
    const update = vi.fn(async () => ({}));
    const businesses = {
      hasOffering: async (_b: string, id: string) => (opts.offerings ?? ['o1']).includes(id),
      hasSegment: async (_b: string, id: string) => (opts.segments ?? ['s1']).includes(id),
    };
    const businessId = opts.businessId === undefined ? 'b1' : opts.businessId;
    const prisma = {
      content: { findUnique: async () => ({ topic: { businessId } }), update },
    };
    const svc = new ContentsService(
      prisma as unknown as PrismaService,
      {} as never,
      { log: vi.fn() } as unknown as AuditService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      businesses as unknown as BusinessApi,
    );
    svc.get = vi.fn(async () => ({}) as never);
    return { svc, update };
  }

  it('saves the content’s own offering and audience, and null returns to the project’s', async () => {
    const { svc, update } = setup();
    await svc.update('c1', { offeringId: 'o1', segmentId: 's1' }, user);
    expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { offeringId: 'o1', segmentId: 's1' } });
    await svc.update('c1', { offeringId: null }, user);
    expect(update).toHaveBeenLastCalledWith({ where: { id: 'c1' }, data: { offeringId: null } });
  });

  it('refuses ones from another business and a project without a business', async () => {
    await expect(setup({ offerings: [] }).svc.update('c1', { offeringId: 'o9' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(setup({ segments: [] }).svc.update('c1', { segmentId: 's9' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(setup({ businessId: null }).svc.update('c1', { offeringId: 'o1' }, user)).rejects.toThrow(
      /no business/,
    );
  });
});
