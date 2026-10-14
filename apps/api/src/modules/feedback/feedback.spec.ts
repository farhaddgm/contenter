import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SetFeedbackSchema } from '@contenter/shared';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { buildFeedbackSummary } from './feedback';
import { FeedbackService } from './feedback.module';

const user = { id: 'u1', role: 'EDITOR' } as AuthUser;

function setup(opts: { version?: unknown; profile?: unknown; denied?: boolean } = {}) {
  const upsert = vi.fn(
    async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      id: 'f1',
      ...create,
      ...update,
      updatedAt: new Date('2026-10-14T08:00:00Z'),
    }),
  );
  const prisma = {
    contentVersion: {
      findUnique: vi.fn(async () =>
        opts.version === undefined
          ? { source: 'AI', jobId: 'j1', content: { topicId: 't1' } }
          : opts.version,
      ),
    },
    contentProfile: {
      findUnique: vi.fn(async () =>
        opts.profile === undefined ? { topicId: 't1', jobId: 'j2' } : opts.profile,
      ),
    },
    aiFeedback: {
      upsert,
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    aiJob: { findMany: vi.fn(async () => []) },
  };
  const assert = vi.fn(async () => {
    if (opts.denied) throw new NotFoundException('Not found');
  });
  const audit = { log: vi.fn() };
  const service = new FeedbackService(
    prisma as unknown as PrismaService,
    { assert } as unknown as AccessService,
    audit as unknown as AuditService,
  );
  return { service, prisma, assert, audit, upsert };
}

describe('SetFeedbackSchema', () => {
  it('takes a thumbs-up alone, and a thumbs-down with a reason and a note', () => {
    expect(SetFeedbackSchema.safeParse({ rating: 'UP' }).success).toBe(true);
    expect(
      SetFeedbackSchema.safeParse({ rating: 'DOWN', reason: 'TONE', note: 'خیلی رسمی' }).success,
    ).toBe(true);
    expect(SetFeedbackSchema.safeParse({ rating: 'DOWN' }).success).toBe(true);
  });
  it('refuses a reason or note on a thumbs-up, an unknown reason, and a too long note', () => {
    expect(SetFeedbackSchema.safeParse({ rating: 'UP', reason: 'TONE' }).success).toBe(false);
    expect(SetFeedbackSchema.safeParse({ rating: 'UP', note: 'x' }).success).toBe(false);
    expect(SetFeedbackSchema.safeParse({ rating: 'DOWN', reason: 'BORING' }).success).toBe(false);
    expect(SetFeedbackSchema.safeParse({ rating: 'DOWN', note: 'ا'.repeat(1001) }).success).toBe(
      false,
    );
  });
});

describe('FeedbackService.set', () => {
  it('records the vote of the caller on the AI job that made the draft, after checking read access to the topic', async () => {
    const { service, upsert, assert } = setup();
    const mine = await service.set(user, 'CONTENT_VERSION', 'v1', {
      rating: 'DOWN',
      reason: 'TONE',
      note: ' خیلی رسمی ',
    });
    expect(assert).toHaveBeenCalledWith(user, 'topic', 't1', 'VIEW');
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_targetType_targetId: { userId: 'u1', targetType: 'CONTENT_VERSION', targetId: 'v1' },
      },
      create: {
        userId: 'u1',
        targetType: 'CONTENT_VERSION',
        targetId: 'v1',
        topicId: 't1',
        jobId: 'j1',
        rating: 'DOWN',
        reason: 'TONE',
        note: 'خیلی رسمی',
      },
      update: { topicId: 't1', jobId: 'j1', rating: 'DOWN', reason: 'TONE', note: 'خیلی رسمی' },
    });
    expect(mine).toMatchObject({
      targetType: 'CONTENT_VERSION',
      rating: 'DOWN',
      reason: 'TONE',
      note: 'خیلی رسمی',
    });
  });

  it('turning a thumbs-down into a thumbs-up drops the reason and the note', async () => {
    const { service, upsert } = setup();
    await service.set(user, 'CONTENT_VERSION', 'v1', { rating: 'UP' });
    expect(upsert.mock.calls[0]![0].update).toMatchObject({ rating: 'UP', reason: null, note: '' });
  });

  it('rates a profile through the job that built it', async () => {
    const { service, upsert } = setup();
    await service.set(user, 'PROFILE', 'p1', { rating: 'UP' });
    expect(upsert.mock.calls[0]![0].create).toMatchObject({
      targetType: 'PROFILE',
      jobId: 'j2',
      topicId: 't1',
    });
  });

  it('does not rate text a person wrote, or something that does not exist', async () => {
    await expect(
      setup({ version: { source: 'ADMIN', jobId: null, content: { topicId: 't1' } } }).service.set(
        user,
        'CONTENT_VERSION',
        'v1',
        { rating: 'UP' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ version: null }).service.set(user, 'CONTENT_VERSION', 'v1', { rating: 'UP' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ profile: null }).service.set(user, 'PROFILE', 'p1', { rating: 'UP' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // a profile typed by hand has no AI job: nothing to rate
    await expect(
      setup({ profile: { topicId: 't1', jobId: null } }).service.set(user, 'PROFILE', 'p1', {
        rating: 'UP',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores nothing when the caller cannot see the topic', async () => {
    const { service, upsert } = setup({ denied: true });
    await expect(
      service.set(user, 'CONTENT_VERSION', 'v1', { rating: 'UP' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps the note out of the audit log', async () => {
    const { service, audit } = setup();
    await service.set(user, 'CONTENT_VERSION', 'v1', {
      rating: 'DOWN',
      reason: 'WRONG_FACT',
      note: 'قیمت غلط است',
    });
    const entry = audit.log.mock.calls[0]![0];
    expect(entry).toMatchObject({
      action: 'ai.feedback',
      entityType: 'ContentVersion',
      entityId: 'v1',
      meta: { rating: 'DOWN', reason: 'WRONG_FACT' },
    });
    expect(JSON.stringify(entry)).not.toContain('قیمت غلط است');
  });
});

describe('FeedbackService.remove and mine', () => {
  it('takes back only the caller’s own vote', async () => {
    const { service, prisma } = setup();
    await service.remove(user, 'CONTENT_VERSION', 'v1');
    expect(prisma.aiFeedback.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', targetType: 'CONTENT_VERSION', targetId: 'v1' },
    });
  });

  it('lists the caller’s votes of one kind in one topic, after the access check', async () => {
    const { service, prisma, assert } = setup();
    await service.mine(user, { targetType: 'CONTENT_VERSION', topicId: 't1' });
    expect(assert).toHaveBeenCalledWith(user, 'topic', 't1', 'VIEW');
    expect(prisma.aiFeedback.findMany.mock.calls[0]![0]!.where).toEqual({
      userId: 'u1',
      targetType: 'CONTENT_VERSION',
      topicId: 't1',
    });
  });

  it('refuses a topic the caller cannot see', async () => {
    const { service } = setup({ denied: true });
    await expect(
      service.mine(user, { targetType: 'PROFILE', topicId: 't9' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('buildFeedbackSummary', () => {
  const jobs = [
    {
      id: 'j1',
      type: 'GENERATE_CONTENT' as const,
      promptKey: 'generate_content',
      promptVersion: 2,
      model: 'm-a',
    },
    {
      id: 'j2',
      type: 'GENERATE_CONTENT' as const,
      promptKey: 'generate_content',
      promptVersion: 3,
      model: 'm-a',
    },
    {
      id: 'j3',
      type: 'GENERATE_CONTENT' as const,
      promptKey: 'generate_content',
      promptVersion: 3,
      model: 'm-a',
    },
  ];

  it('counts votes per prompt version and model, merging jobs that share them', () => {
    const s = buildFeedbackSummary({
      days: 90,
      votes: [
        { jobId: 'j1', rating: 'UP', count: 1 },
        { jobId: 'j2', rating: 'DOWN', count: 2 },
        { jobId: 'j3', rating: 'DOWN', count: 1 },
        { jobId: 'j3', rating: 'UP', count: 1 },
      ],
      jobs,
      reasons: [],
      recentNotes: [],
    });
    expect(s).toMatchObject({ total: 5, up: 2, down: 3, downShare: 0.6 });
    expect(s.byPrompt).toHaveLength(2);
    expect(s.byPrompt[0]).toMatchObject({ promptVersion: 3, up: 1, down: 3 });
    expect(s.byPrompt[1]).toMatchObject({ promptVersion: 2, up: 1, down: 0 });
  });

  it('puts votes without a known job together, and handles no votes', () => {
    const s = buildFeedbackSummary({
      days: 30,
      votes: [
        { jobId: null, rating: 'UP', count: 2 },
        { jobId: 'gone', rating: 'DOWN', count: 1 },
      ],
      jobs: [],
      reasons: [],
      recentNotes: [],
    });
    expect(s.byPrompt).toEqual([
      { type: null, promptKey: null, promptVersion: null, model: null, up: 2, down: 1 },
    ]);
    expect(
      buildFeedbackSummary({ days: 7, votes: [], jobs: [], reasons: [], recentNotes: [] }),
    ).toMatchObject({ total: 0, downShare: null, byPrompt: [], byReason: [] });
  });

  it('counts the reasons of the thumbs-down, an empty or unknown reason as none', () => {
    const s = buildFeedbackSummary({
      days: 90,
      votes: [],
      jobs: [],
      reasons: [
        { reason: 'TONE', count: 4 },
        { reason: null, count: 2 },
        { reason: 'BORING', count: 1 },
        { reason: 'WRONG_FACT', count: 1 },
      ],
      recentNotes: [],
    });
    expect(s.byReason).toEqual([
      { reason: 'TONE', count: 4 },
      { reason: 'NONE', count: 3 },
      { reason: 'WRONG_FACT', count: 1 },
    ]);
  });
});

describe('FeedbackService.summary', () => {
  it('looks only at the period and reads the prompt of each voted job', async () => {
    const { service, prisma } = setup();
    prisma.aiFeedback.groupBy
      .mockResolvedValueOnce([{ jobId: 'j1', rating: 'UP', _count: { _all: 3 } }] as never)
      .mockResolvedValueOnce([] as never);
    prisma.aiJob.findMany.mockResolvedValueOnce([
      {
        id: 'j1',
        type: 'GENERATE_CONTENT',
        promptKey: 'generate_content',
        promptVersion: 1,
        model: 'm',
      },
    ] as never);
    const s = await service.summary({ days: 30 });
    const since = prisma.aiFeedback.groupBy.mock.calls[0]![0]!.where.createdAt.gte as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(prisma.aiJob.findMany.mock.calls[0]![0]!.where).toEqual({ id: { in: ['j1'] } });
    expect(s.byPrompt[0]).toMatchObject({ promptKey: 'generate_content', up: 3 });
  });
});
