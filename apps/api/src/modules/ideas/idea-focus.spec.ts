import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { AuditService } from '../audit/audit.service';
import type { BusinessApi } from '../businesses/business-api';
import { IdeasService } from './ideas.module';

const user = { id: 'u1', role: 'EDITOR' } as AuthUser;

function setup(opts: { idea?: unknown; problem?: string | null } = {}) {
  const update = vi.fn(async ({ data }: { data: unknown }) => ({ id: 'i1', ...(data as object) }));
  const focusProblem = vi.fn(async (_b: unknown, _f: unknown) => opts.problem ?? null);
  const prisma = {
    idea: {
      findUnique: async () => (opts.idea === undefined ? { topic: { businessId: 'b1' } } : opts.idea),
      update,
    },
  };
  const svc = new IdeasService(
    prisma as unknown as PrismaService,
    {} as unknown as AiJobsService,
    { log: vi.fn() } as unknown as AuditService,
    { focusProblem } as unknown as BusinessApi,
  );
  return { svc, update, focusProblem };
}

describe('IdeasService.update: what the idea is about (docs/73)', () => {
  it('saves an offering and an audience of the project business', async () => {
    const { svc, update, focusProblem } = setup();
    await svc.update('i1', { offeringId: 'o1', segmentId: 's1' }, user);
    expect(focusProblem).toHaveBeenCalledWith('b1', { offeringId: 'o1', segmentId: 's1' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { offeringId: 'o1', segmentId: 's1' } });
  });

  it('refuses one of another business, and an idea that does not exist', async () => {
    const { svc, update } = setup({ problem: 'Audience not found in this business' });
    await expect(svc.update('i1', { segmentId: 'x' }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    await expect(setup({ idea: null }).svc.update('zz', { offeringId: 'o1' }, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('null returns to the project without asking the business, and other edits never ask', async () => {
    const clear = setup();
    await clear.svc.update('i1', { offeringId: null, segmentId: null }, user);
    expect(clear.focusProblem).not.toHaveBeenCalled();
    expect(clear.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { offeringId: null, segmentId: null } });
    const other = setup();
    await other.svc.update('i1', { status: 'SHORTLISTED' }, user);
    expect(other.focusProblem).not.toHaveBeenCalled();
  });
});
