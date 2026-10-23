import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { COMPETITOR_SOURCE_LIMIT, type InstagramStats } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { BUSINESS_PROMPT_INCLUDE, EXPORT_INCLUDE, type BusinessApi } from './business-api';
import { CompetitorSourcesService } from './competitor-sources.service';
import type { SourceReader } from './social/source-reader.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;

const sourceRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  competitorId: 'c1',
  kind: 'URL',
  url: 'https://a.example/about',
  title: '',
  content: '',
  analysis: null,
  status: 'PENDING',
  error: null,
  fetchedAt: null,
  createdById: 'u1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const stats = (over: Partial<InstagramStats> = {}) =>
  ({
    postsAnalyzed: 12,
    postsPerWeek: 4,
    avgCaptionChars: 100,
    avgEmojisPerPost: 1,
    avgHashtagsPerPost: 2,
    topHashtags: [],
    scriptShare: { persian: 1, latin: 0 },
    ctaShare: 0,
    questionShare: 0,
    engagement: null,
    ...over,
  }) as InstagramStats;

function setup(opts: { count?: number; existing?: unknown; snapshot?: unknown; brand?: InstagramStats | null; competitors?: unknown[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const prisma = {
    businessCompetitor: {
      findUnique: async () => ({ id: 'c1', businessId: 'b1' }),
      findMany: async () => opts.competitors ?? [],
    },
    businessCompetitorSource: {
      count: async () => opts.count ?? 0,
      findFirst: async () => opts.existing ?? null,
      findUnique: async () => sourceRow({ kind: 'INSTAGRAM', analysis: { provider: 'MANUAL' } }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return sourceRow({ ...data, id: 'new' });
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return sourceRow({ ...data });
      },
      delete: vi.fn(),
    },
  };
  const reader = {
    snapshot: vi.fn(async () => opts.snapshot ?? { status: 'READY', content: 'متن صفحه', title: 'درباره ما' }),
    manualInstagram: vi.fn(() => ({
      url: 'https://www.instagram.com/rival/',
      title: 'Instagram @rival',
      content: 'snapshot',
      analysis: { type: 'INSTAGRAM', provider: 'MANUAL', stats: stats() },
    })),
  };
  const audit = { log: vi.fn() };
  const businesses = { instagramStats: async () => (opts.brand === undefined ? stats() : opts.brand) };
  const svc = new CompetitorSourcesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    reader as unknown as SourceReader,
    businesses as unknown as BusinessApi,
  );
  return { svc, created, updated, reader, audit };
}

describe('CompetitorSourcesService', () => {
  it('reads a link through the shared reader and stores the snapshot', async () => {
    const { svc, created, updated, reader } = setup();
    const out = await svc.add('c1', { url: 'https://a.example/about' }, user);
    expect(reader.snapshot).toHaveBeenCalledWith('URL', 'https://a.example/about', '');
    expect(created[0]).toMatchObject({ competitorId: 'c1', kind: 'URL', createdById: 'u1' });
    expect(updated[0]).toMatchObject({ status: 'READY', content: 'متن صفحه', title: 'درباره ما' });
    expect(out.status).toBe('READY');
  });

  it('stores a failed read as FAILED with the reason, never throwing', async () => {
    const { svc, updated } = setup({ snapshot: { status: 'FAILED', error: 'login wall', unexpected: false } });
    const out = await svc.add('c1', { url: 'https://a.example/x' }, user);
    expect(updated[0]).toEqual({ status: 'FAILED', error: 'login wall' });
    expect(out.status).toBe('FAILED');
  });

  it('turns an Instagram link into an account source and refuses a post link', async () => {
    const { svc, reader } = setup();
    await svc.add('c1', { url: 'https://instagram.com/rival' }, user);
    expect(reader.snapshot).toHaveBeenCalledWith('INSTAGRAM', 'https://www.instagram.com/rival/', 'Instagram @rival');
    await expect(svc.add('c1', { url: 'https://www.instagram.com/p/abc123/' }, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores hand-typed Instagram data and pasted text without any fetch', async () => {
    const { svc, created, reader } = setup();
    await svc.add('c1', { instagram: { handle: '@rival', posts: [{ caption: 'سلام' }] } }, user);
    await svc.add('c1', { content: 'متن چسبانده', title: 'یادداشت' }, user);
    expect(reader.snapshot).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ kind: 'INSTAGRAM', status: 'READY', content: 'snapshot' });
    expect(created[1]).toMatchObject({ kind: 'TEXT', status: 'READY', content: 'متن چسبانده' });
  });

  it('refuses more than the source limit and a link that is already a source', async () => {
    await expect(setup({ count: COMPETITOR_SOURCE_LIMIT }).svc.add('c1', { content: 'x' }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ existing: sourceRow() }).svc.add('c1', { url: 'https://a.example/about' }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().svc.add('c1', {}, user)).rejects.toThrow();
  });

  it('has nothing to refresh for hand-typed Instagram data', async () => {
    await expect(setup().svc.refresh('s1', user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('compares the business with the latest readable Instagram source of each active competitor', async () => {
    const competitors = [
      { id: 'c1', name: 'الف', sources: [{ analysis: { type: 'INSTAGRAM', provider: 'MANUAL', stats: stats({ postsPerWeek: 9 }) } }] },
      { id: 'c2', name: 'ب', sources: [] },
    ];
    const out = await setup({ competitors }).svc.compare('b1');
    expect(out.competitors.map((c) => c.state)).toEqual(['OK', 'NONE']);
    expect(out.rows.find((r) => r.metric === 'postsPerWeek')).toMatchObject({ brand: 4, max: 9 });
    expect((await setup({ brand: null, competitors }).svc.compare('b1')).brand.state).toBe('NONE');
  });

  it('does not exist for a missing source', async () => {
    const { svc } = setup();
    const prisma = (svc as unknown as { prisma: { businessCompetitorSource: { findUnique: () => Promise<null> } } }).prisma;
    prisma.businessCompetitorSource.findUnique = async () => null;
    await expect(svc.text('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('competitor sources never reach a prompt or an export (docs/70 §4.5)', () => {
  it('is not part of the prompt include nor the export include', () => {
    const keys = [...Object.keys(BUSINESS_PROMPT_INCLUDE), ...Object.keys(EXPORT_INCLUDE)].join(' ').toLowerCase();
    expect(keys).not.toContain('competitor');
  });
});
