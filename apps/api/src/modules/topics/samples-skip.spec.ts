import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SetSamplesSkippedSchema } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { AccessService } from '../../common/access';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { TopicsService } from './topics.module';

const admin = { id: 'u1', email: 'a@x.test', role: 'ADMIN' } as AuthUser;

/** `undefined` = the topic does not exist; otherwise its current `samplesSkippedAt`. */
function setup(samplesSkippedAt: Date | null | undefined) {
  const row = samplesSkippedAt === undefined ? null : { id: 't1', samplesSkippedAt };
  const update = vi.fn(async () => ({}));
  const log = vi.fn();
  const access = {
    memberInclude: () => ({}),
    withAccess: (_u: AuthUser, t: unknown) => t,
  } as unknown as AccessService;
  const svc = new TopicsService(
    { topic: { findUnique: async () => row, update } } as unknown as PrismaService,
    { log } as unknown as AuditService,
    access,
  );
  return { svc, update, log };
}

describe('TopicsService.setSamplesSkipped', () => {
  it('records the skip and audits it', async () => {
    const { svc, update, log } = setup(null);
    await svc.setSamplesSkipped('t1', { skipped: true }, admin);
    expect(update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { samplesSkippedAt: expect.any(Date) },
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'topic.samples_skip' }));
  });

  it('resumes the step by clearing the timestamp', async () => {
    const { svc, update, log } = setup(new Date());
    await svc.setSamplesSkipped('t1', { skipped: false }, admin);
    expect(update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { samplesSkippedAt: null } });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'topic.samples_resume' }));
  });

  it('is idempotent: no write, no audit when nothing changes', async () => {
    const skipped = setup(new Date('2026-10-01T00:00:00Z'));
    await skipped.svc.setSamplesSkipped('t1', { skipped: true }, admin);
    const open = setup(null);
    await open.svc.setSamplesSkipped('t1', { skipped: false }, admin);
    for (const s of [skipped, open]) {
      expect(s.update).not.toHaveBeenCalled();
      expect(s.log).not.toHaveBeenCalled();
    }
  });

  it('404s for an unknown topic', async () => {
    const { svc } = setup(undefined);
    await expect(svc.setSamplesSkipped('nope', { skipped: true }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('requires a boolean', () => {
    expect(SetSamplesSkippedSchema.safeParse({ skipped: true }).success).toBe(true);
    expect(SetSamplesSkippedSchema.safeParse({}).success).toBe(false);
    expect(SetSamplesSkippedSchema.safeParse({ skipped: 'yes' }).success).toBe(false);
  });
});
