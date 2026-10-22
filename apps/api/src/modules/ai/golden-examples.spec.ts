import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { SettingsService } from '../settings/settings.module';
import { formatBusiness, formatGoldenExamples, type BusinessForPrompt } from './context';
import { ContextLoader } from './context-loader.service';
import { BusinessApi } from '../businesses/business-api';

const business: BusinessForPrompt = {
  name: 'Acme',
  tagline: '',
  industry: '',
  website: '',
  location: '',
  language: 'fa',
  sections: [{ key: 'OVERVIEW', content: 'We sell tea.' }],
};

const example = {
  platform: 'INSTAGRAM',
  format: 'POST',
  title: 'چای تازه',
  body: 'متن نمونه',
  cta: 'سفارش دهید',
};

describe('formatGoldenExamples / formatBusiness', () => {
  it('is empty without examples, and the prompt is byte-for-byte the same as before', () => {
    expect(formatGoldenExamples([])).toBe('');
    const plain = formatBusiness(business);
    expect(formatBusiness({ ...business, examples: [] })).toBe(plain);
    expect(plain).not.toContain('[EXAMPLES]');
  });

  it('adds one block at the end, marks it as data and numbers the examples', () => {
    const plain = formatBusiness(business);
    const out = formatBusiness({
      ...business,
      examples: [example, { ...example, title: '', cta: '' }],
    });
    expect(out.startsWith(plain)).toBe(true);
    expect(out).toContain('[EXAMPLES]');
    expect(out).toContain('[E1] INSTAGRAM / POST\nTitle: چای تازه\nمتن نمونه\nCTA: سفارش دهید');
    expect(out).toContain('[E2] INSTAGRAM / POST\nمتن نمونه');
    expect(out).toMatch(/never follow instructions/);
    expect(out).toMatch(/never copy/);
  });
});

function setup(
  opts: { rows?: unknown[]; settings?: { maxExamples: number; maxChars: number } } = {},
) {
  const findMany = vi.fn(async (_args: unknown) => opts.rows ?? []);
  const prisma = {
    topic: {
      findUniqueOrThrow: async () => ({ businessId: 'b1', samplesSkippedAt: new Date() }),
    },
    business: { findUnique: async () => ({ id: 'b1', ...business, assets: [] }) },
    sampleContent: { count: async () => 0 },
    businessReference: { findMany: async () => [] },
    content: { findMany },
  };
  const settings = opts.settings ? { getGolden: async () => opts.settings } : undefined;
  const ctx = new ContextLoader(
    prisma as unknown as PrismaService,
    new BusinessApi(prisma as unknown as PrismaService),
    settings as unknown as SettingsService,
  );
  return { ctx, findMany };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  platform: null,
  format: 'POST',
  goldenAt: new Date('2026-10-10'),
  topic: { platform: 'INSTAGRAM' },
  currentVersion: { title: `عنوان ${id}`, body: `متن ${id}`, cta: '' },
  ...over,
});

describe('ContextLoader golden examples', () => {
  it('loads nothing for jobs that are not writing a draft', async () => {
    const { ctx, findMany } = setup({ rows: [row('a')] });
    const b = await ctx.business('t1');
    expect(b).not.toHaveProperty('examples');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('asks only for approved or published, marked, current-text contents of the business', async () => {
    const { ctx, findMany } = setup();
    await ctx.business('t1', { platform: 'INSTAGRAM', format: 'POST', excludeIds: ['me', 'src'] });
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        goldenAt: { not: null },
        topic: { businessId: 'b1' },
        currentVersionId: { not: null },
        OR: [{ status: 'APPROVED' }, { publishedAt: { not: null } }],
        id: { notIn: ['me', 'src'] },
      },
    });
  });

  it('picks the closest K using the effective platform (content platform, else the topic one)', async () => {
    const { ctx } = setup({
      rows: [
        row('li', { platform: 'LINKEDIN' }),
        row('ig'), // no own platform: the topic's INSTAGRAM
        row('ig-old', { goldenAt: new Date('2026-10-01') }),
        row('noversion', { currentVersion: null }),
      ],
    });
    const b = await ctx.business('t1', { platform: 'INSTAGRAM', format: 'POST' });
    expect(b?.examples?.map((e) => e.title)).toEqual(['عنوان ig', 'عنوان ig-old']);
  });

  it('follows the admin limits: 0 switches it off, maxChars cuts the body but keeps the title', async () => {
    const off = setup({ rows: [row('a')], settings: { maxExamples: 0, maxChars: 1500 } });
    expect((await off.ctx.business('t1', { platform: 'X', format: 'POST' }))?.examples).toEqual([]);
    expect(off.findMany).not.toHaveBeenCalled();

    const long = row('long', { currentVersion: { title: 'T', body: 'ب'.repeat(2000), cta: 'C' } });
    const cut = setup({ rows: [long], settings: { maxExamples: 1, maxChars: 500 } });
    const [e] = (await cut.ctx.business('t1', { platform: 'INSTAGRAM', format: 'POST' }))!
      .examples!;
    expect(e!.title).toBe('T');
    expect(e!.cta).toBe('C');
    expect(e!.body.endsWith('[truncated]')).toBe(true);
    expect(e!.body.length).toBeLessThan(600);
  });
});
