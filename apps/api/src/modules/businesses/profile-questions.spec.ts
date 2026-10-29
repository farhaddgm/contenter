import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { ProfileQuestionsService } from './profile-questions.service';

const admin = { id: 'u1', role: 'ADMIN' } as AuthUser;
const editor = { id: 'u2', role: 'EDITOR' } as AuthUser;
const NOW = new Date('2026-10-23T00:00:00Z');

interface Audiences {
  segments?: { id: string }[];
  links?: { offeringId: string; segmentId: string }[];
  offerings?: Record<string, unknown>[];
}

function setup(opts: { content?: string; lock?: string; audiences?: Audiences } = {}) {
  const writes: Record<string, unknown>[] = [];
  const skips: { code: string }[] = [];
  const tx = {
    businessSection: {
      findUnique: async () => ({ id: 's1', content: opts.content ?? '', source: 'ADMIN', lock: opts.lock ?? 'NONE', reviewedAt: NOW }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({}),
    },
    businessSectionRevision: { create: vi.fn() },
  };
  const prisma = {
    businessSection: {
      findMany: async () => [
        { key: 'OVERVIEW', content: opts.content ?? '', source: 'ADMIN', reviewedAt: NOW, updatedAt: NOW, lock: opts.lock ?? 'NONE' },
      ],
    },
    businessFact: { count: async () => 1 },
    businessCompetitor: { count: async () => 1 },
    businessOffering: {
      findMany: async () =>
        opts.audiences?.offerings ?? [
          { claims: [] },
          { claims: [{ feature: 'a', benefit: '', proof: '' }, { feature: 'b', benefit: '', proof: 'x' }] },
          { claims: 'broken' },
        ],
    },
    businessSegment: { findMany: async () => opts.audiences?.segments ?? [] },
    offeringSegment: { findMany: async () => opts.audiences?.links ?? [] },
    businessQuestionSkip: {
      findMany: async () => skips,
      upsert: vi.fn(async ({ create }: { create: { code: string } }) => {
        skips.push({ code: create.code });
      }),
      deleteMany: vi.fn(async () => {
        skips.length = 0;
      }),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const audit = { log: vi.fn() };
  const svc = new ProfileQuestionsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { svc, writes, audit, prisma };
}

describe('ProfileQuestionsService', () => {
  it('counts offerings without claims and unproven claims from the stored JSON', async () => {
    const out = await setup().svc.list('b1', admin, NOW);
    const byCode = Object.fromEntries(out.questions.map((q) => [q.code, q.count]));
    expect(byCode['OFFERINGS_NO_CLAIMS']).toBe(2); // one empty, one malformed
    expect(byCode['CLAIMS_UNPROVEN']).toBe(1);
  });

  it('appends the answer to the section text and keeps it out of the audit log', async () => {
    const { svc, writes, audit } = setup({ content: 'قبلی' });
    await svc.answer('b1', { code: 'SECTION_THIN:OVERVIEW', answer: 'پاسخ تازه' }, admin);
    expect(writes[0]).toMatchObject({ content: 'قبلی\n\nپاسخ تازه', source: 'ADMIN' });
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('پاسخ تازه');
  });

  it('only section questions can be answered here', async () => {
    await expect(setup().svc.answer('b1', { code: 'NO_FACTS', answer: 'x' }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('respects the section lock when answering', async () => {
    await expect(
      setup({ lock: 'ADMIN_ONLY' }).svc.answer('b1', { code: 'SECTION_EMPTY:OVERVIEW', answer: 'x' }, editor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('leaves out questions about sections the asker may not change', async () => {
    const out = await setup({ lock: 'ADMIN_ONLY' }).svc.list('b1', editor, NOW);
    expect(out.questions.map((q) => q.code)).not.toContain('SECTION_THIN:OVERVIEW');
  });

  it('skips a question and brings it back on reset', async () => {
    const { svc } = setup();
    const skipped = await svc.skip('b1', 'OFFERINGS_NO_CLAIMS', admin);
    expect(skipped.questions.map((q) => q.code)).not.toContain('OFFERINGS_NO_CLAIMS');
    expect(skipped.skipped).toBe(1);
    const back = await svc.resetSkips('b1', admin);
    expect(back.questions.map((q) => q.code)).toContain('OFFERINGS_NO_CLAIMS');
  });
});

describe('audience questions (docs/73)', () => {
  const offering = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    parentId: null,
    push: 1,
    status: 'ACTIVE',
    stock: 'IN_STOCK',
    claims: [{ feature: 'a', benefit: 'b', proof: 'p' }],
    peakMonths: [],
    availableFrom: null,
    availableUntil: null,
    ...over,
  });
  const codes = async (audiences: Audiences) =>
    (await setup({ audiences }).svc.list('b1', admin, NOW)).questions.map((q) => [q.code, q.count] as const);

  it('asks for audiences when there are products but none', async () => {
    const out = await codes({ offerings: [offering('o1')] });
    expect(out).toContainEqual(['NO_SEGMENTS', 0]);
    expect(out.map(([c]) => c)).not.toContain('OFFERINGS_NO_AUDIENCE');
  });

  it('counts the sellable products no audience is linked to, and the audiences linked to no product', async () => {
    const out = await codes({
      offerings: [offering('o1'), offering('o2'), offering('o3', { status: 'PAUSED' }), offering('o4', { push: 0 })],
      segments: [{ id: 's1' }, { id: 's2' }],
      links: [{ offeringId: 'o1', segmentId: 's1' }],
    });
    expect(out).toContainEqual(['OFFERINGS_NO_AUDIENCE', 1]);
    expect(out).toContainEqual(['SEGMENTS_NO_OFFERING', 1]);
    expect(out.map(([c]) => c)).not.toContain('NO_SEGMENTS');
  });

  it('does not ask about a line whose variants carry the audiences', async () => {
    const out = await codes({
      offerings: [offering('L'), offering('V', { parentId: 'L' })],
      segments: [{ id: 's1' }],
      links: [{ offeringId: 'V', segmentId: 's1' }],
    });
    expect(out.map(([c]) => c)).not.toContain('OFFERINGS_NO_AUDIENCE');
  });

  it('is quiet when every product has an audience and every audience a product', async () => {
    const out = await codes({
      offerings: [offering('o1')],
      segments: [{ id: 's1' }],
      links: [{ offeringId: 'o1', segmentId: 's1' }],
    });
    const found = out.map(([c]) => c);
    expect(found).not.toContain('NO_SEGMENTS');
    expect(found).not.toContain('OFFERINGS_NO_AUDIENCE');
    expect(found).not.toContain('SEGMENTS_NO_OFFERING');
  });

  it('can be skipped like every other question', async () => {
    const { svc } = setup({ audiences: { offerings: [offering('o1')] } });
    const after = await svc.skip('b1', 'NO_SEGMENTS', admin);
    expect(after.questions.map((q) => q.code)).not.toContain('NO_SEGMENTS');
    expect(after.skipped).toBeGreaterThan(0);
  });
});
