import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { resolveCompetitorProposals, type CompetitorsPropose } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { AuditService } from '../audit/audit.service';
import { BusinessCompetitorsProposeRunner } from '../ai/runners/business-competitors.runner';
import { CompetitorsService } from './competitors.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

const SECTION =
  'رقیب اصلی ما «دیجی‌وام» است که وام فوری می‌دهد.\nبعضی مشتری‌ها هم خودشان پول جمع می‌کنند و به ما نمی‌آیند.';

const proposal = (over: Partial<CompetitorsPropose['competitors'][number]> = {}) => ({
  name: 'دیجی‌وام',
  kind: 'DIRECT' as const,
  website: '',
  positioning: '',
  pricing: '',
  strengths: [],
  weaknesses: [],
  difference: '',
  evidence: 'رقیب اصلی ما «دیجی‌وام» است که وام فوری می‌دهد.',
  ...over,
});

const resolve = (
  proposals: CompetitorsPropose['competitors'],
  over: Partial<Parameters<typeof resolveCompetitorProposals>[0]> = {},
) =>
  resolveCompetitorProposals({
    proposals,
    sources: [SECTION],
    existing: [],
    ownName: 'ویپاد',
    room: 8,
    ...over,
  });

describe('resolveCompetitorProposals (docs/70 §11)', () => {
  it('keeps a card whose quote is in a source and names the competitor', () => {
    const out = resolve([proposal()]);
    expect(out.rows.map((r) => r.name)).toEqual(['دیجی‌وام']);
    expect(out.dropped).toEqual([]);
  });

  it('drops a quote the sources do not contain', () => {
    const out = resolve([proposal({ evidence: 'دیجی‌وام بزرگ‌ترین وام‌دهندهٔ کشور است' })]);
    expect(out.rows).toEqual([]);
    expect(out.dropped[0]!.reason).toBe('NO_EVIDENCE');
  });

  it('drops a rival the quote does not name, even if the quote is real', () => {
    const out = resolve([
      proposal({ name: 'بانک‌یار', evidence: 'بعضی مشتری‌ها هم خودشان پول جمع می‌کنند' }),
    ]);
    expect(out.rows).toEqual([]);
    expect(out.dropped[0]!.reason).toBe('NAME_NOT_IN_QUOTE');
  });

  it('skips a name already stored, the business itself and anything over the room', () => {
    expect(resolve([proposal()], { existing: ['دیجی وام'] }).dropped[0]!.reason).toBe('DUPLICATE');
    expect(resolve([proposal()], { ownName: 'دیجی‌وام' }).dropped[0]!.reason).toBe('DUPLICATE');
    expect(resolve([proposal()], { room: 0 }).dropped[0]!.reason).toBe('LIMIT');
  });

  it('keeps a website only when a source states it', () => {
    const sources = [`${SECTION}\nسایتشان https://digivam.example است.`];
    const kept = resolve([proposal({ website: 'https://digivam.example' })], { sources });
    expect(kept.rows[0]!.website).toBe('https://digivam.example');
    const invented = resolve([proposal({ website: 'https://digivam.ir' })], { sources });
    expect(invented.rows[0]!.website).toBe('');
  });
});

function runnerEnv(data: CompetitorsPropose, opts: { sectionText?: string; existing?: string[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    business: {
      findUnique: async () => ({
        id: 'b1',
        name: 'ویپاد',
        tagline: '',
        industry: '',
        website: '',
        location: '',
        language: 'fa',
        sections: [{ key: 'COMPETITORS', content: opts.sectionText ?? SECTION, source: 'ADMIN', reviewedAt: null }],
        facts: [],
        terms: [],
        assets: [],
        offerings: [],
      }),
    },
    businessCompetitor: {
      findMany: async () => (opts.existing ?? []).map((name) => ({ name })),
      create: async ({ data: d }: { data: Record<string, unknown> }) => {
        created.push(d);
        return { id: 'c1' };
      },
    },
    businessFact: { findMany: async () => [] },
    businessReference: { findMany: async () => [] },
  };
  const execute = vi.fn(async (_a: unknown) => ({
    data,
    model: 'm',
    usage,
    prompt: { key: 'business_competitors_propose', version: 1 },
  }));
  const runner = new BusinessCompetitorsProposeRunner(
    prisma as unknown as PrismaService,
    { execute } as unknown as AiExecutor,
  );
  return { runner, created, execute };
}

describe('BusinessCompetitorsProposeRunner', () => {
  it('saves verified proposals inactive and unverified, with their quote', async () => {
    const { runner, created } = runnerEnv({
      competitors: [proposal(), proposal({ name: 'ناشناس', evidence: 'ساختگی که در منبع نیست' })],
      notes: '',
    });
    const out = await runner.run({ id: 'j1', targetId: 'b1', input: {} } as never);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: 'دیجی‌وام',
      source: 'AI',
      verified: false,
      isActive: false,
      jobId: 'j1',
      evidence: expect.stringContaining('دیجی‌وام'),
    });
    expect(out.output).toMatchObject({ proposed: 2, saved: 1, dropped: 1 });
  });

  it('refuses when there is nothing stored to read', async () => {
    const { runner, execute } = runnerEnv({ competitors: [], notes: '' }, { sectionText: '' });
    await expect(runner.run({ id: 'j1', targetId: 'b1', input: {} } as never)).rejects.toThrow(
      /nothing to read/,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('CompetitorsService: proposals', () => {
  function env(row: Record<string, unknown> | null, counts = { section: 1, facts: 0, refs: 0, cards: 0 }) {
    const enqueue = vi.fn(async (_a: unknown) => ({ id: 'job1' }));
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'c1',
      businessId: 'b1',
      kind: 'DIRECT',
      strengths: [],
      weaknesses: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }));
    const prisma = {
      businessCompetitor: { findUnique: async () => row, update, count: async () => counts.cards },
      businessSection: { count: async () => counts.section },
      businessFact: { count: async () => counts.facts },
      businessReference: { count: async () => counts.refs },
      aiJob: { findFirst: async () => null },
    };
    const service = new CompetitorsService(
      prisma as unknown as PrismaService,
      { log: vi.fn() } as unknown as AuditService,
      { enqueue } as never,
    );
    return { service, enqueue, update };
  }

  it('does not switch on a proposed card until it is confirmed', async () => {
    const { service, update } = env({ id: 'c1', businessId: 'b1', name: 'x', verified: false });
    await expect(service.update('c1', { isActive: true }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    await service.confirm('c1', user);
    expect(update.mock.calls[0]![0].data).toMatchObject({ verified: true, isActive: true });
  });

  it('queues a proposal only when something is stored to read', async () => {
    const ok = env(null);
    await ok.service.propose('b1', user);
    expect(ok.enqueue.mock.calls[0]![0]).toMatchObject({ type: 'BUSINESS_COMPETITORS_PROPOSE' });
    const empty = env(null, { section: 0, facts: 0, refs: 0, cards: 0 });
    await expect(empty.service.propose('b1', user)).rejects.toBeInstanceOf(BadRequestException);
    const full = env(null, { section: 1, facts: 0, refs: 0, cards: 8 });
    await expect(full.service.propose('b1', user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
