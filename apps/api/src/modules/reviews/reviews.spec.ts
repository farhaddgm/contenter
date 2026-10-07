import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewStage, ContentStatus } from '@contenter/shared';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../../common/auth.decorators';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.module';
import { CommentsService } from './comments.service';
import { ReviewsService } from './reviews.service';

const admin: AuthUser = { id: 'admin', email: 'a@x.test', role: 'ADMIN' };
const editor: AuthUser = { id: 'ed', email: 'e@x.test', role: 'EDITOR' };
const author: AuthUser = { id: 'au', email: 'u@x.test', role: 'VIEWER' };

const audit = { log: vi.fn() } as unknown as AuditService;
const settings = (requireFinalApproval = true) =>
  ({ getWorkflow: async () => ({ requireFinalApproval }) }) as unknown as SettingsService;

interface Stored {
  status: ContentStatus;
  reviewStage: ReviewStage | null;
  submittedById: string | null;
  currentVersionId: string | null;
}

function setup(stored: Stored | null, opts: { raceLost?: boolean; requireFinal?: boolean } = {}) {
  const updateMany = vi.fn(async () => ({ count: opts.raceLost ? 0 : 1 }));
  const update = vi.fn(async () => ({}));
  const create = vi.fn(async () => ({}));
  const tx = {
    content: { findUnique: async () => stored, updateMany, update },
    contentReview: { create },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const svc = new ReviewsService(
    prisma as unknown as PrismaService,
    audit,
    settings(opts.requireFinal),
  );
  return { svc, updateMany, update, create, tx };
}

const draft: Stored = {
  status: 'DRAFT',
  reviewStage: null,
  submittedById: null,
  currentVersionId: 'v1',
};
const inReview = (stage: ReviewStage, submittedById = 'au'): Stored => ({
  status: 'IN_REVIEW',
  reviewStage: stage,
  submittedById,
  currentVersionId: 'v1',
});

describe('ReviewsService.act', () => {
  it('submits a draft: moves it, records the submitter and writes the history', async () => {
    const { svc, updateMany, create } = setup(draft);
    await expect(svc.act('c1', 'submit', {}, author)).resolves.toEqual({
      status: 'IN_REVIEW',
      reviewStage: 'EDITORIAL',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'DRAFT', reviewStage: null },
      data: expect.objectContaining({
        status: 'IN_REVIEW',
        reviewStage: 'EDITORIAL',
        submittedById: 'au',
      }),
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        contentId: 'c1',
        versionId: 'v1',
        stage: null,
        decision: 'SUBMITTED',
        actorId: 'au',
        note: '',
      },
    });
  });

  it('hands an editor-approved content to the final approver', async () => {
    const { svc, create } = setup(inReview('EDITORIAL'));
    await expect(svc.act('c1', 'approve', { note: 'good' }, editor)).resolves.toEqual({
      status: 'IN_REVIEW',
      reviewStage: 'FINAL',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ decision: 'APPROVED', stage: 'EDITORIAL', note: 'good' }),
    });
  });

  it('finishes at the editor when final approval is switched off', async () => {
    const { svc } = setup(inReview('EDITORIAL'), { requireFinal: false });
    await expect(svc.act('c1', 'approve', {}, editor)).resolves.toEqual({
      status: 'APPROVED',
      reviewStage: null,
    });
  });

  it('clears the submitter when the content goes back to DRAFT', async () => {
    const { svc, updateMany } = setup(inReview('FINAL'));
    await svc.act('c1', 'request_changes', { note: 'tone is off' }, admin);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'IN_REVIEW', reviewStage: 'FINAL' },
      data: expect.objectContaining({ status: 'DRAFT', submittedById: null, submittedAt: null }),
    });
  });

  it('requires a note for changes and rejections', async () => {
    const { svc, updateMany } = setup(inReview('EDITORIAL'));
    await expect(svc.act('c1', 'reject', {}, editor)).rejects.toThrow(BadRequestException);
    await expect(svc.act('c1', 'request_changes', { note: ' x ' }, editor)).rejects.toThrow(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers 403 for a missing role and 409 for a wrong state', async () => {
    // an editor cannot give the final approval
    await expect(setup(inReview('FINAL')).svc.act('c1', 'approve', {}, editor)).rejects.toThrow(
      ForbiddenException,
    );
    // nobody can approve a draft
    await expect(setup(draft).svc.act('c1', 'approve', {}, admin)).rejects.toThrow(
      ConflictException,
    );
  });

  it('does not let editors review their own submission', async () => {
    await expect(
      setup(inReview('EDITORIAL', 'ed')).svc.act('c1', 'approve', {}, editor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('loses the race gracefully when the content moved meanwhile', async () => {
    const { svc, create } = setup(inReview('EDITORIAL'), { raceLost: true });
    await expect(svc.act('c1', 'approve', {}, editor)).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('404s for a missing content', async () => {
    await expect(setup(null).svc.act('nope', 'submit', {}, author)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ReviewsService.resetAfterEdit', () => {
  it('returns approved text to DRAFT and records why', async () => {
    const { svc, tx, create } = setup({
      status: 'APPROVED',
      reviewStage: null,
      submittedById: 'au',
      currentVersionId: 'v2',
    });
    await expect(svc.resetAfterEdit(tx as never, 'c1', 'ed')).resolves.toBe(true);
    expect(tx.content.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'DRAFT', reviewStage: null, submittedById: null, submittedAt: null },
    });
    expect(create).toHaveBeenCalledWith({
      data: { contentId: 'c1', versionId: 'v2', stage: null, decision: 'RESET', actorId: 'ed' },
    });
  });

  it('leaves a draft alone', async () => {
    const { svc, tx, create } = setup(draft);
    await expect(svc.resetAfterEdit(tx as never, 'c1', 'ed')).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.info', () => {
  it('lists what the caller may do', async () => {
    const { svc } = setup(null);
    const info = await svc.info(inReview('EDITORIAL'), editor);
    expect(info).toEqual({
      requireFinalApproval: true,
      actions: ['approve', 'request_changes', 'reject'],
    });
  });
});

describe('CommentsService', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'k1',
    contentId: 'c1',
    versionId: 'v1',
    parentId: null,
    authorId: 'au',
    body: 'hello',
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date('2026-10-08T10:00:00Z'),
    updatedAt: new Date('2026-10-08T10:00:00Z'),
    author: { id: 'au', name: 'A' },
    resolvedBy: null,
    version: { version: 1 },
    ...over,
  });

  const make = (prisma: Record<string, unknown>) =>
    new CommentsService(prisma as unknown as PrismaService, audit);

  it('nests replies under their thread, oldest first', async () => {
    const svc = make({
      contentComment: {
        findMany: async () => [
          row({ id: 'k1' }),
          row({ id: 'k2', parentId: 'k1', body: 'reply' }),
          row({ id: 'k3' }),
        ],
      },
    });
    const threads = await svc.list('c1');
    expect(threads.map((t) => t.id)).toEqual(['k1', 'k3']);
    expect(threads[0]!.replies?.map((r) => r.id)).toEqual(['k2']);
    expect(threads[0]!.version).toBe(1);
    expect(threads[0]!.createdAt).toBe('2026-10-08T10:00:00.000Z');
  });

  it('refuses nested replies and foreign parents', async () => {
    const parent = { parentId: 'top', versionId: 'v1' };
    const svc = make({
      content: { findUnique: async () => ({ currentVersionId: 'v1' }) },
      contentComment: { findFirst: vi.fn(async () => parent) },
    });
    await expect(svc.create('c1', { body: 'x', parentId: 'k2' }, author)).rejects.toThrow(/nested/);
    const svc2 = make({
      content: { findUnique: async () => ({ currentVersionId: 'v1' }) },
      contentComment: { findFirst: async () => null },
    });
    await expect(svc2.create('c1', { body: 'x', parentId: 'zz' }, author)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a version of another content', async () => {
    const svc = make({
      content: { findUnique: async () => ({ currentVersionId: 'v1' }) },
      contentVersion: { findFirst: async () => null },
    });
    await expect(svc.create('c1', { body: 'x', versionId: 'other' }, author)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('puts a reply on the version of its thread, a new thread on the current version', async () => {
    const create = vi.fn(async ({ data }: { data: { versionId: string } }) =>
      row({ versionId: data.versionId }),
    );
    const svc = make({
      content: { findUnique: async () => ({ currentVersionId: 'v3' }) },
      contentComment: {
        findFirst: async () => ({ parentId: null, versionId: 'v1' }),
        create,
      },
    });
    await svc.create('c1', { body: 'top' }, author);
    expect(create.mock.calls[0]![0].data.versionId).toBe('v3');
    await svc.create('c1', { body: 'reply', parentId: 'k1' }, author);
    expect(create.mock.calls[1]![0].data.versionId).toBe('v1');
  });

  it('lets only the author or an admin edit and delete', async () => {
    const found = row({});
    const prisma = {
      contentComment: {
        findUnique: async () => found,
        update: vi.fn(async () => found),
        delete: vi.fn(),
      },
    };
    const svc = make(prisma);
    await expect(svc.update('k1', { body: 'edit' }, editor)).rejects.toThrow(ForbiddenException);
    await expect(svc.update('k1', { body: 'edit' }, author)).resolves.toBeTruthy();
    await expect(svc.update('k1', { body: 'edit' }, admin)).resolves.toBeTruthy();
    await expect(svc.remove('k1', editor)).rejects.toThrow(ForbiddenException);
    await expect(svc.remove('k1', author)).resolves.toBeUndefined();
  });

  it('lets any editor resolve a thread, but not a reply', async () => {
    const update = vi.fn(async () => row({}));
    const svc = make({
      contentComment: { findUnique: async () => row({}), update },
    });
    await svc.update('k1', { resolved: true }, editor);
    expect(update.mock.calls[0]![0].data).toMatchObject({ resolvedById: 'ed' });
    await svc.update('k1', { resolved: false }, editor);
    expect(update.mock.calls[1]![0].data).toMatchObject({ resolvedAt: null, resolvedById: null });

    const reply = make({
      contentComment: { findUnique: async () => row({ parentId: 'k0' }), update },
    });
    await expect(reply.update('k1', { resolved: true }, editor)).rejects.toThrow(/top-level/);
  });
});
