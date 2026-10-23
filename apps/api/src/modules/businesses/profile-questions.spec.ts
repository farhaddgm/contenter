import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { ProfileQuestionsService } from './profile-questions.service';

const admin = { id: 'u1', role: 'ADMIN' } as AuthUser;
const editor = { id: 'u2', role: 'EDITOR' } as AuthUser;
const NOW = new Date('2026-10-23T00:00:00Z');

function setup(opts: { content?: string; lock?: string } = {}) {
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
      findMany: async () => [
        { claims: [] },
        { claims: [{ feature: 'a', benefit: '', proof: '' }, { feature: 'b', benefit: '', proof: 'x' }] },
        { claims: 'broken' },
      ],
    },
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
