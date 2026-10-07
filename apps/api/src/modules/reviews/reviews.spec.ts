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
import type { NotificationsService } from '../notifications/notifications.service';
import { CommentsService } from './comments.service';
import { ReviewsService } from './reviews.service';

const admin: AuthUser = { id: 'admin', email: 'a@x.test', role: 'ADMIN' };
const editor: AuthUser = { id: 'ed', email: 'e@x.test', role: 'EDITOR' };
const author: AuthUser = { id: 'au', email: 'u@x.test', role: 'VIEWER' };

const audit = { log: vi.fn() } as unknown as AuditService;

/** The recipient lookups answer with fixed ids, so a test can see who would be told. */
function fakeNotifications(over: Record<string, unknown> = {}) {
  const notify = vi.fn(async () => undefined);
  const notifications = {
    reviewersOf: async () => ['rev1', 'rev2'],
    admins: async () => ['adm1'],
    authorsOf: async () => ['au'],
    participantsOf: async () => ['p1', 'p2'],
    notify,
    ...over,
  } as unknown as NotificationsService;
  return { notifications, notify };
}
const settings = (requireFinalApproval = true) =>
  ({ getWorkflow: async () => ({ requireFinalApproval }) }) as unknown as SettingsService;

interface Stored {
  status: ContentStatus;
  reviewStage: ReviewStage | null;
  submittedById: string | null;
  currentVersionId: string | null;
}

function setup(
  stored: Stored | null,
  opts: {
    raceLost?: boolean;
    requireFinal?: boolean;
    notifications?: Record<string, unknown>;
  } = {},
) {
  const { notifications, notify } = fakeNotifications(opts.notifications);
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
    notifications,
  );
  return { svc, updateMany, update, create, tx, notify };
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

describe('ReviewsService and the calendar', () => {
  it('takes a content off the calendar when it leaves APPROVED', async () => {
    const { svc, updateMany } = setup({
      status: 'APPROVED',
      reviewStage: null,
      submittedById: null,
      currentVersionId: 'v1',
    });
    await svc.act('c1', 'reopen', {}, author);
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({ status: 'DRAFT', scheduledAt: null });
  });

  it('leaves the plan alone when the content stays approved', async () => {
    const { svc, updateMany } = setup(inReview('FINAL'));
    await svc.act('c1', 'approve', {}, admin);
    expect(updateMany.mock.calls[0]![0].data).not.toHaveProperty('scheduledAt');
  });

  it('drops the plan when edited text sends an approved content back to draft', async () => {
    const { svc, tx } = setup({
      status: 'APPROVED',
      reviewStage: null,
      submittedById: null,
      currentVersionId: 'v1',
    });
    await svc.resetAfterEdit(tx as never, 'c1', 'ed');
    expect(tx.content.update.mock.calls[0]![0].data).toMatchObject({ scheduledAt: null });
  });

  it('offers nothing for a published content', async () => {
    const { svc } = setup(null);
    const info = await svc.info(
      {
        status: 'APPROVED',
        reviewStage: null,
        submittedById: null,
        currentVersionId: 'v1',
        publishedAt: new Date(),
      },
      admin,
    );
    expect(info.actions).toEqual([]);
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
      data: {
        status: 'DRAFT',
        reviewStage: null,
        submittedById: null,
        submittedAt: null,
        scheduledAt: null,
      },
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

  const notified = fakeNotifications();
  const make = (prisma: Record<string, unknown>) =>
    new CommentsService(prisma as unknown as PrismaService, audit, notified.notifications);

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

describe('who is told about a review step', () => {
  const about = { id: 'c1', title: 'عنوان', topicId: 't1' };
  const withTitle = (stored: Stored): Stored & { id: string; title: string; topicId: string } => ({
    ...stored,
    id: 'c1',
    title: 'عنوان',
    topicId: 't1',
  });

  it('tells the reviewers about a submission, not the submitter', async () => {
    const { svc, notify } = setup(withTitle(draft));
    await svc.act('c1', 'submit', {}, author);
    expect(notify).toHaveBeenCalledWith({
      event: 'REVIEW_SUBMITTED',
      recipients: ['rev1', 'rev2'],
      actor: { id: 'au' },
      content: about,
      note: undefined,
    });
  });

  it('tells the admins when an editor passes the content on', async () => {
    const { svc, notify } = setup(withTitle(inReview('EDITORIAL')));
    await svc.act('c1', 'approve', {}, editor);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REVIEW_FINAL_NEEDED', recipients: ['adm1'] }),
    );
  });

  it('tells the authors about an approval: final stage, one-stage flow, finalize', async () => {
    for (const [stored, action, user, requireFinal] of [
      [inReview('FINAL'), 'approve', admin, true],
      [inReview('EDITORIAL'), 'approve', editor, false],
      [draft, 'finalize', admin, true],
    ] as const) {
      const { svc, notify } = setup(withTitle(stored), { requireFinal });
      await svc.act('c1', action, {}, user);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'REVIEW_APPROVED', recipients: ['au'] }),
      );
    }
  });

  it('tells the authors why changes were asked for or the content was rejected', async () => {
    const asked = setup(withTitle(inReview('EDITORIAL')));
    await asked.svc.act('c1', 'request_changes', { note: 'لحن را رسمی‌تر کنید' }, editor);
    expect(asked.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'REVIEW_CHANGES_REQUESTED',
        recipients: ['au'],
        note: 'لحن را رسمی‌تر کنید',
      }),
    );
    const rejected = setup(withTitle(inReview('EDITORIAL')));
    await rejected.svc.act('c1', 'reject', { note: 'خارج از موضوع' }, editor);
    expect(rejected.notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REVIEW_REJECTED', note: 'خارج از موضوع' }),
    );
  });

  it('stays quiet for a withdrawal and a reopen', async () => {
    const withdrawn = setup(withTitle(inReview('EDITORIAL')));
    await withdrawn.svc.act('c1', 'withdraw', {}, author);
    expect(withdrawn.notify).not.toHaveBeenCalled();
    const reopened = setup(withTitle({ ...draft, status: 'APPROVED' }));
    await reopened.svc.act('c1', 'reopen', {}, author);
    expect(reopened.notify).not.toHaveBeenCalled();
  });

  it('does not tell anyone about a step that was refused', async () => {
    const { svc, notify } = setup(withTitle(draft));
    await expect(svc.act('c1', 'approve', {}, admin)).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  it('still completes the step when looking up the recipients fails', async () => {
    const { svc, updateMany } = setup(withTitle(draft), {
      notifications: {
        reviewersOf: async () => {
          throw new Error('db hiccup');
        },
      },
    });
    await expect(svc.act('c1', 'submit', {}, author)).resolves.toMatchObject({
      status: 'IN_REVIEW',
    });
    expect(updateMany).toHaveBeenCalled();
  });
});

describe('who is told about a comment', () => {
  const content = {
    currentVersionId: 'v1',
    title: 'عنوان',
    topicId: 't1',
    createdById: 'creator',
    submittedById: null,
  };
  const created = (over: Record<string, unknown> = {}) => ({
    id: 'k9',
    contentId: 'c1',
    versionId: 'v1',
    parentId: null,
    authorId: 'au',
    body: 'نظر',
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date('2026-10-08T10:00:00Z'),
    updatedAt: new Date('2026-10-08T10:00:00Z'),
    author: { id: 'au', name: 'A' },
    resolvedBy: null,
    version: { version: 1 },
    ...over,
  });

  function build(
    opts: {
      parent?: unknown;
      earlier?: { authorId: string | null }[];
      notifications?: Record<string, unknown>;
    } = {},
  ) {
    const n = fakeNotifications(opts.notifications);
    const findMany = vi.fn(async () => opts.earlier ?? []);
    const svc = new CommentsService(
      {
        content: { findUnique: async () => content },
        contentComment: {
          findFirst: async () => opts.parent ?? null,
          create: async ({ data }: { data: Record<string, unknown> }) => created(data),
          findMany,
        },
      } as unknown as PrismaService,
      audit,
      n.notifications,
    );
    return { svc, notify: n.notify, findMany };
  }

  it('tells the people around the content about a new thread', async () => {
    const { svc, notify, findMany } = build({ earlier: [{ authorId: 'x' }, { authorId: null }] });
    await svc.create('c1', { body: 'قلاب ضعیف است' }, author);
    // for a new thread the commenters of the whole content count
    expect(findMany.mock.calls[0]![0].where).toEqual({ contentId: 'c1' });
    expect(notify).toHaveBeenCalledWith({
      event: 'COMMENT_ADDED',
      recipients: ['p1', 'p2'],
      actor: { id: 'au' },
      content: { id: 'c1', title: 'عنوان', topicId: 't1' },
      note: 'قلاب ضعیف است',
    });
  });

  it('tells the thread about a reply, looking only at that thread', async () => {
    const { svc, notify, findMany } = build({ parent: { parentId: null, versionId: 'v1' } });
    await svc.create('c1', { body: 'موافقم', parentId: 'k1' }, author);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      OR: [{ id: 'k1' }, { parentId: 'k1' }],
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'COMMENT_REPLIED' }));
  });

  it('still saves the comment when looking up the recipients fails', async () => {
    const { svc } = build({
      notifications: {
        participantsOf: async () => {
          throw new Error('db hiccup');
        },
      },
    });
    await expect(svc.create('c1', { body: 'نظر' }, author)).resolves.toMatchObject({ id: 'k9' });
  });
});
