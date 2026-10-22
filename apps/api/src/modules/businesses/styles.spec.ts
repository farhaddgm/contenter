import { BadRequestException } from '@nestjs/common';
import type { AiJob } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  AddStyleSourceSchema,
  BUSINESS_STYLE_LIMIT,
  STYLE_SOURCE_LIMIT,
  StyleBuildSchema,
  isStyleUsable,
} from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import { ContextLoader } from '../ai/context-loader.service';
import { formatBusiness, formatStyle } from '../ai/context';
import { MockProvider } from '../ai/provider/mock.provider';
import { BusinessStyleBuildRunner } from '../ai/runners/business-style.runner';
import type { AuditService } from '../audit/audit.service';
import type { MediaFetcherService } from '../samples/media-fetcher.service';
import { BusinessApi } from './business-api';
import type { InstagramService } from './social/instagram.service';
import type { WebsiteCrawlerService } from './social/website-crawler.service';
import { StylesService } from './styles.service';

const admin = { id: 'u1', role: 'ADMIN' } as AuthUser;

const style = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  businessId: 'b1',
  name: 'صمیمی',
  direction: '',
  buildState: 'NONE',
  buildError: null,
  summary: '',
  traits: [],
  guide: '',
  caveats: [],
  builtAt: null,
  reviewedAt: null,
  updatedAt: new Date('2026-10-22T00:00:00Z'),
  ...over,
});

function service(db: Record<string, unknown>) {
  const log = vi.fn();
  const enqueue = vi.fn(async () => ({ id: 'job1' }));
  const fetch = vi.fn();
  const svc = new StylesService(
    db as unknown as PrismaService,
    { log } as unknown as AuditService,
    { enqueue } as unknown as AiJobsService,
    { fetch } as unknown as MediaFetcherService,
    {} as InstagramService,
    {} as WebsiteCrawlerService,
  );
  return { svc, log, enqueue, fetch };
}

describe('StyleBuildSchema', () => {
  it('accepts the mock provider output (the shape the model must return)', async () => {
    // generateStructured validates the mock output against the schema, so it throws if they drift
    const { data } = await new MockProvider().generateStructured({
      task: 'BUSINESS_STYLE_BUILD',
      model: 'm',
      effort: 'low',
      system: 's',
      user: 'u',
      schema: StyleBuildSchema,
    });
    expect(data.traits.length).toBeGreaterThan(0);
    expect(data.guide).not.toBe('');
  });

  it('rejects a guide that is empty or a style without traits', () => {
    expect(StyleBuildSchema.safeParse({ summary: 'x', traits: [], guide: 'y' }).success).toBe(false);
    expect(
      StyleBuildSchema.safeParse({
        summary: 'x',
        traits: [{ category: 'TONE', name: 'a', description: 'b' }],
        guide: '',
      }).success,
    ).toBe(false);
  });
});

describe('AddStyleSourceSchema', () => {
  it('needs exactly one of link, text or Instagram data', () => {
    expect(AddStyleSourceSchema.safeParse({}).success).toBe(false);
    expect(AddStyleSourceSchema.safeParse({ url: 'https://a.ir', content: 'x' }).success).toBe(false);
    expect(AddStyleSourceSchema.safeParse({ url: 'https://a.ir' }).success).toBe(true);
    expect(AddStyleSourceSchema.safeParse({ content: 'متن' }).success).toBe(true);
  });
  it('refuses non-http links and a site without a link', () => {
    expect(AddStyleSourceSchema.safeParse({ url: 'ftp://a.ir' }).success).toBe(false);
    expect(AddStyleSourceSchema.safeParse({ content: 'x', site: true }).success).toBe(false);
  });
});

describe('isStyleUsable', () => {
  it('is true only for a built and confirmed style', () => {
    expect(isStyleUsable({ buildState: 'READY', reviewedAt: '2026-10-22' })).toBe(true);
    expect(isStyleUsable({ buildState: 'READY', reviewedAt: null })).toBe(false);
    expect(isStyleUsable({ buildState: 'BUILDING', reviewedAt: '2026-10-22' })).toBe(false);
  });
});

describe('formatStyle / formatBusiness', () => {
  const st = {
    name: 'صمیمی',
    summary: 'جمله‌های کوتاه',
    guide: 'با سؤال شروع کن.',
    traits: [{ category: 'HOOK', name: 'سؤال', description: 'اول سؤال' }],
  };
  const biz = { name: 'کافه', tagline: '', industry: '', website: '', location: '', language: 'fa', sections: [] };

  it('is empty without a style or a guide', () => {
    expect(formatStyle(null)).toBe('');
    expect(formatStyle({ ...st, guide: ' ' })).toBe('');
  });

  it('states its own precedence rule and lists the guide', () => {
    const text = formatStyle(st);
    expect(text).toContain('[STYLE]');
    expect(text).toContain('[FACTS]');
    expect(text).toContain('HOOK — سؤال: اول سؤال');
    expect(text).toContain('Guide:\nبا سؤال شروع کن.');
  });

  it('leaves the business block byte-identical when there is no style', () => {
    const without = formatBusiness(biz as never);
    expect(formatBusiness({ ...biz, style: null } as never)).toBe(without);
    expect(formatBusiness({ ...biz, style: st } as never)).toBe(`${without}\n\n${formatStyle(st)}`);
  });
});

describe('BusinessApi.styleForPrompt', () => {
  it('asks only for a built, confirmed style of that business', async () => {
    const findFirst = vi.fn(async () => ({ name: 'n', summary: 's', guide: 'g', traits: [{ category: 'TONE', name: 'a', description: 'b' }] }));
    const api = new BusinessApi({ businessStyle: { findFirst } } as unknown as PrismaService);
    const out = await api.styleForPrompt('b1', 's1');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', businessId: 'b1', buildState: 'READY', reviewedAt: { not: null } },
      }),
    );
    expect(out?.guide).toBe('g');
  });

  it('returns null for another business or an unconfirmed style', async () => {
    const api = new BusinessApi({ businessStyle: { findFirst: async () => null } } as unknown as PrismaService);
    expect(await api.styleForPrompt('b1', 's1')).toBeNull();
  });
});

describe('StylesService', () => {
  it('names a style once per business and caps their number', async () => {
    const create = vi.fn(async () => ({ id: 's1' }));
    const base = {
      business: { findUnique: async () => ({ id: 'b1' }) },
      businessStyle: {
        count: async () => 0,
        findFirst: async () => ({ id: 'other' }),
        create,
        findUnique: async () => ({ ...style(), _count: { sources: 0, topics: 0 }, sources: [] }),
      },
    };
    await expect(service(base).svc.create('b1', { name: 'صمیمی' }, admin)).rejects.toThrow(
      /already exists/,
    );
    const capped = { ...base, businessStyle: { ...base.businessStyle, count: async () => BUSINESS_STYLE_LIMIT } };
    await expect(service(capped).svc.create('b1', { name: 'تازه' }, admin)).rejects.toThrow(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('confirms the style when the admin edits the guide, and not before it is built', async () => {
    const update = vi.fn(async () => ({}));
    const get = async () => ({ ...style({ buildState: 'READY', guide: 'g' }), _count: { sources: 1, topics: 0 }, sources: [] });
    const built = service({ businessStyle: { findUnique: get, update } });
    await built.svc.update('s1', { guide: 'راهنمای تازه' }, admin);
    expect(update.mock.calls[0]![0].data.reviewedAt).toBeInstanceOf(Date);

    const fresh = service({
      businessStyle: { findUnique: async () => style(), update },
    });
    await expect(fresh.svc.update('s1', { guide: 'x' }, admin)).rejects.toThrow(/Build the style first/);
  });

  it('builds only with a readable source, then queues one job and marks it building', async () => {
    const update = vi.fn(async () => ({}));
    const none = service({
      businessStyle: { findUnique: async () => style(), update },
      styleSource: { count: async () => 0 },
    });
    await expect(none.svc.build('s1', admin)).rejects.toThrow(/at least one source/);
    expect(none.enqueue).not.toHaveBeenCalled();

    const ok = service({
      businessStyle: { findUnique: async () => style(), update },
      styleSource: { count: async () => 2 },
    });
    expect(await ok.svc.build('s1', admin)).toEqual({ id: 's1', jobId: 'job1' });
    expect(ok.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BUSINESS_STYLE_BUILD', targetId: 's1' }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ buildState: 'BUILDING' }) }),
    );
  });

  it('caps the sources of one style', async () => {
    const { svc } = service({
      businessStyle: { findUnique: async () => style() },
      styleSource: { count: async () => STYLE_SOURCE_LIMIT },
    });
    await expect(svc.addSource('s1', { content: 'متن نمونه' }, admin)).rejects.toThrow(/at most/);
  });

  it('stores a pasted text as a READY source without any fetch', async () => {
    const created = { id: 'src1', styleId: 's1', kind: 'TEXT', url: '', title: '', content: 'متن نمونه', analysis: null, status: 'READY', error: null, fetchedAt: new Date() };
    const create = vi.fn(async () => created);
    const { svc, fetch } = service({
      businessStyle: { findUnique: async () => style() },
      styleSource: { count: async () => 0, create, findUnique: async () => created },
    });
    const out = await svc.addSource('s1', { content: 'متن نمونه' }, admin);
    expect(out).toMatchObject({ id: 'src1', kind: 'TEXT', status: 'READY', chars: 9 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an Instagram post link (it is not an account)', async () => {
    const { svc } = service({
      businessStyle: { findUnique: async () => style() },
      styleSource: { count: async () => 0 },
    });
    await expect(
      svc.addSource('s1', { url: 'https://www.instagram.com/p/ABC123/' }, admin),
    ).rejects.toThrow(/not an account/);
  });
});

describe('BusinessStyleBuildRunner', () => {
  const job = { id: 'j1', targetId: 's1' } as AiJob;
  const business = { name: 'کافه', tagline: '', industry: '', website: '', location: '', language: 'fa', sections: [], facts: [], terms: [], assets: [] };

  it('writes the result as an unconfirmed style and gives every source an equal share', async () => {
    const update = vi.fn(async () => ({}));
    const execute = vi.fn(async (args: { vars: Record<string, string> }) => ({
      data: {
        summary: 'خلاصه',
        traits: [{ category: 'TONE', name: 'a', description: 'b' }],
        guide: 'راهنما',
        caveats: [],
      },
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
      prompt: { key: 'business_style_build', version: 1 },
      vars: args.vars,
    }));
    const prisma = {
      businessStyle: {
        findUnique: async () => ({
          id: 's1',
          businessId: 'b1',
          name: 'صمیمی',
          direction: 'لحن را بگیر',
          business,
          sources: [
            { kind: 'INSTAGRAM', title: 'A', url: 'https://x/a', content: 'متن الف' },
            { kind: 'TEXT', title: 'B', url: '', content: 'متن ب' },
          ],
        }),
        update,
      },
    };
    const runner = new BusinessStyleBuildRunner(
      prisma as unknown as PrismaService,
      { execute } as unknown as AiExecutor,
    );
    const result = await runner.run(job);
    const vars = execute.mock.calls[0]![0].vars;
    expect(vars.sources).toContain('[S1] INSTAGRAM');
    expect(vars.sources).toContain('[S2] TEXT');
    expect(vars.direction).toBe('لحن را بگیر');
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ buildState: 'READY', guide: 'راهنما', reviewedAt: null });
    expect(result.output).toMatchObject({ styleId: 's1', sources: 2 });
  });

  it('refuses a style with no readable source without calling the model', async () => {
    const execute = vi.fn();
    const runner = new BusinessStyleBuildRunner(
      { businessStyle: { findUnique: async () => ({ id: 's1', business, sources: [] }) } } as unknown as PrismaService,
      { execute } as unknown as AiExecutor,
    );
    await expect(runner.run(job)).rejects.toThrow(/at least one source/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('marks the style failed and building again on retry', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const runner = new BusinessStyleBuildRunner(
      { businessStyle: { updateMany } } as unknown as PrismaService,
      {} as AiExecutor,
    );
    await runner.onFailure(job, 'boom');
    await runner.onRetry(job);
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({ buildState: 'FAILED', buildError: 'boom' });
    expect(updateMany.mock.calls[1]![0].data).toMatchObject({ buildState: 'BUILDING', buildError: null });
  });
});

describe('ContextLoader.business with a style', () => {
  const biz = { id: 'b1', name: 'کافه', tagline: '', industry: '', website: '', location: '', language: 'fa', sections: [], assets: [], facts: [], terms: [] };
  const row = { name: 'صمیمی', summary: 'خلاصه', guide: 'با سؤال شروع کن.', traits: [] };

  function loader(styleRow: unknown) {
    const findFirst = vi.fn(async () => styleRow);
    const prisma = {
      topic: {
        findUniqueOrThrow: async () => ({ businessId: 'b1', styleId: 's1', samplesSkippedAt: new Date(), title: 't', description: '', audience: '' }),
      },
      business: { findUnique: async () => biz },
      businessReference: { findMany: async () => [] },
      businessStyle: { findFirst },
      content: { findMany: async () => [] },
      sampleContent: { count: async () => 0 },
    } as unknown as PrismaService;
    return { ctx: new ContextLoader(prisma, new BusinessApi(prisma), { getGolden: async () => ({ maxExamples: 0, maxChars: 100 }) } as never), findFirst };
  }

  it('hands the confirmed style to a draft being written, not to other jobs', async () => {
    const { ctx, findFirst } = loader(row);
    const draft = await ctx.business('t1', { platform: 'INSTAGRAM', format: 'POST' });
    expect(draft?.style?.guide).toBe('با سؤال شروع کن.');
    expect(formatBusiness(draft)).toContain('[STYLE]');
    findFirst.mockClear();
    const other = await ctx.business('t1');
    expect(other?.style).toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('leaves the style out when it is not built and confirmed', async () => {
    const { ctx } = loader(null);
    const draft = await ctx.business('t1', { platform: 'INSTAGRAM', format: 'POST' });
    expect(draft?.style).toBeNull();
    expect(formatBusiness(draft)).not.toContain('[STYLE]');
  });
});
