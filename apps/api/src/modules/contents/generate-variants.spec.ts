import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { AuditService } from '../audit/audit.service';
import type { BusinessApi } from '../businesses/business-api';
import type { SettingsService } from '../settings/settings.module';
import { withAngle } from '../ai/runners/content.runners';
import { ContentsService } from './contents.module';

const user = { id: 'u1', role: 'EDITOR' } as AuthUser;

function setup(maxVariants = 3, opts: { idea?: Record<string, unknown> | null; problem?: string | null } = {}) {
  let n = 0;
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `c${++n}`,
    ...data,
  }));
  const update = vi.fn(async () => ({}));
  const enqueue = vi.fn(async (_j: unknown) => ({ id: `j${n}` }));
  const focusProblem = vi.fn(async (_b: unknown, _f: unknown) => opts.problem ?? null);
  const prisma = {
    topic: { findUniqueOrThrow: async () => ({ businessId: 'b1' }) },
    idea: { findFirst: async () => opts.idea ?? null },
    content: { create, update },
  };
  const svc = new ContentsService(
    prisma as unknown as PrismaService,
    { enqueue } as unknown as AiJobsService,
    { log: vi.fn() } as unknown as AuditService,
    {} as never,
    {} as never,
    {} as never,
    { getVariants: async () => ({ maxVariants }) } as unknown as SettingsService,
    {} as never,
    {} as never,
    {} as never,
    { focusProblem: focusProblem } as unknown as BusinessApi,
  );
  return { svc, create, enqueue, focusProblem };
}

const brief = 'یک پست دربارهٔ قهوهٔ تازه';

describe('ContentsService.generate with variants', () => {
  it('a single draft is the old path: no group, no angle, same answer plus a one-item list', async () => {
    const { svc, create, enqueue } = setup();
    const r = await svc.generate('t1', { brief }, user);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0].data).toMatchObject({
      variantGroupId: null,
      variantAngle: null,
    });
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ input: { variants: 1 } });
    expect(JSON.stringify(enqueue.mock.calls[0]![0])).not.toContain('variantAngle');
    expect(r).toMatchObject({ contentId: 'c1', jobId: 'j1' });
    expect(r.variants).toEqual([{ contentId: 'c1', jobId: 'j1', angle: null }]);
  });

  it('three drafts share one group, get three different angles and one job each', async () => {
    const { svc, create, enqueue } = setup();
    const r = await svc.generate('t1', { brief, variants: 3 }, user);
    const groups = create.mock.calls.map((c) => c[0].data.variantGroupId);
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).toEqual(expect.any(String));
    expect(create.mock.calls.map((c) => c[0].data.variantAngle)).toEqual([
      'DIRECT',
      'STORY',
      'QUESTION',
    ]);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(
      enqueue.mock.calls.map(
        (c) => (c[0] as { input: { variantAngle: string } }).input.variantAngle,
      ),
    ).toEqual(['DIRECT', 'STORY', 'QUESTION']);
    expect(r.variants.map((v) => v.contentId)).toEqual(['c1', 'c2', 'c3']);
    expect(r.contentId).toBe('c1');
  });

  it('refuses more drafts than the admin allows, before creating anything', async () => {
    const { svc, create, enqueue } = setup(2);
    await expect(svc.generate('t1', { brief, variants: 3 }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    await expect(svc.generate('t1', { brief, variants: 2 }, user)).resolves.toBeDefined();
  });
});

describe('withAngle', () => {
  it('leaves a single draft’s brief untouched and appends the fixed angle otherwise', () => {
    expect(withAngle('brief', null)).toBe('brief');
    expect(withAngle('brief', 'made-up')).toBe('brief');
    const out = withAngle('brief', 'STORY');
    expect(out.startsWith('brief\n\n')).toBe(true);
    expect(out).toContain('narrative');
  });
});

describe('ContentsService.generate: what the drafts are about (docs/73)', () => {
  const idea = { id: 'i1', title: 'ایده', format: 'POST', tags: [], offeringId: 'o-idea', segmentId: 's-idea' };

  it('gives a draft the idea focus, unless one was chosen for it, and nothing when neither exists', async () => {
    const fromIdea = setup(3, { idea });
    await fromIdea.svc.generate('t1', { ideaId: 'i1' }, user);
    expect(fromIdea.create.mock.calls[0]![0].data).toMatchObject({ offeringId: 'o-idea', segmentId: 's-idea' });

    const chosen = setup(3, { idea });
    await chosen.svc.generate('t1', { ideaId: 'i1', offeringId: 'o-pick' }, user);
    expect(chosen.create.mock.calls[0]![0].data).toMatchObject({ offeringId: 'o-pick', segmentId: 's-idea' });

    const plain = setup();
    await plain.svc.generate('t1', { brief: 'یک پست دربارهٔ قهوهٔ تازه' }, user);
    expect(plain.create.mock.calls[0]![0].data).toMatchObject({ offeringId: null, segmentId: null });
  });

  it('every draft of a group carries the same focus', async () => {
    const { svc, create } = setup(3, { idea });
    await svc.generate('t1', { ideaId: 'i1', variants: 3 }, user);
    expect(create.mock.calls.map((c) => (c[0] as { data: { offeringId: string } }).data.offeringId)).toEqual([
      'o-idea',
      'o-idea',
      'o-idea',
    ]);
  });

  it('checks a chosen offering or audience against the project business, and creates nothing when refused', async () => {
    const { svc, create, enqueue, focusProblem } = setup(3, { problem: 'Offering not found in this business' });
    await expect(
      svc.generate('t1', { brief: 'یک پست دربارهٔ قهوهٔ تازه', offeringId: 'x' }, user),
    ).rejects.toThrow(BadRequestException);
    expect(focusProblem).toHaveBeenCalledWith('b1', expect.objectContaining({ offeringId: 'x' }));
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
