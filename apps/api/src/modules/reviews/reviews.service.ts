import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Content, Prisma } from '@prisma/client';
import {
  applyReviewAction,
  resetAfterEdit,
  reviewActionsFor,
  REVIEW_ACTIONS_NEEDING_NOTE,
  type ContentReviewInfo,
  type NotificationEvent,
  type ReviewAction,
  type ReviewBodyInput,
  type ReviewTransition,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../../common/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.module';

/** The Prisma delegates the review code touches, so it also runs inside a transaction. */
type Db = Pick<Prisma.TransactionClient, 'content' | 'contentReview'>;

const MIN_NOTE_LENGTH = 3;

export const REVIEW_INCLUDE = {
  actor: { select: { id: true, name: true } },
} satisfies Prisma.ContentReviewInclude;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What `user` may do with the content now, for the detail response. */
  async info(
    content: Pick<
      Content,
      'status' | 'reviewStage' | 'submittedById' | 'currentVersionId' | 'publishedAt'
    >,
    user: AuthUser,
  ): Promise<ContentReviewInfo> {
    const workflow = await this.settings.getWorkflow();
    return {
      requireFinalApproval: workflow.requireFinalApproval,
      actions: reviewActionsFor(
        {
          status: content.status,
          reviewStage: content.reviewStage,
          submittedById: content.submittedById,
          hasVersion: !!content.currentVersionId,
          published: !!content.publishedAt,
        },
        { id: user.id, role: user.role },
        workflow,
      ),
    };
  }

  /** Newest first. */
  history(contentId: string, take = 50) {
    return this.prisma.contentReview.findMany({
      where: { contentId },
      orderBy: { createdAt: 'desc' },
      take,
      include: REVIEW_INCLUDE,
    });
  }

  /** Takes one step of the workflow. The state machine is `applyReviewAction` (shared). */
  async act(contentId: string, action: ReviewAction, input: ReviewBodyInput, user: AuthUser) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) throw new NotFoundException('Content not found');
    const note = (input.note ?? '').trim();
    if (REVIEW_ACTIONS_NEEDING_NOTE.includes(action) && note.length < MIN_NOTE_LENGTH) {
      throw new BadRequestException('A note explaining the decision is required');
    }

    const workflow = await this.settings.getWorkflow();
    const result = applyReviewAction(
      {
        status: content.status,
        reviewStage: content.reviewStage,
        submittedById: content.submittedById,
        hasVersion: !!content.currentVersionId,
        published: !!content.publishedAt,
      },
      action,
      { id: user.id, role: user.role },
      workflow,
    );
    if (!result.ok) {
      if (result.reason === 'not_allowed') {
        throw new ForbiddenException('You cannot take this step on this content');
      }
      throw new ConflictException('This step is not possible in the content’s current state');
    }
    const { next } = result;

    await this.prisma.$transaction(async (tx) => {
      // compare-and-set: two reviewers clicking at once must not both succeed
      const moved = await tx.content.updateMany({
        where: { id: contentId, status: content.status, reviewStage: content.reviewStage },
        data: {
          status: next.status,
          reviewStage: next.reviewStage,
          ...(action === 'submit'
            ? { submittedById: user.id, submittedAt: new Date() }
            : next.status === 'DRAFT'
              ? { submittedById: null, submittedAt: null }
              : {}),
          // only an approved content stays on the calendar
          ...(next.status === 'APPROVED' ? {} : { scheduledAt: null }),
        },
      });
      if (moved.count !== 1) {
        throw new ConflictException('The content changed while you were deciding; reload it');
      }
      await tx.contentReview.create({
        data: {
          contentId,
          versionId: content.currentVersionId,
          stage: next.stage,
          decision: next.decision,
          actorId: user.id,
          note,
        },
      });
    });

    this.audit.log({
      userId: user.id,
      action: `content.review.${action}`,
      entityType: 'Content',
      entityId: contentId,
      meta: { from: content.status, to: next.status, stage: next.stage, note: note || undefined },
    });
    try {
      await this.tell(content, action, next, note, user);
    } catch (err) {
      // looking up who to tell failed; the step itself is done and must not be reported as failed
      this.logger.warn(`could not notify about ${action}: ${(err as Error).message}`);
    }
    return { status: next.status, reviewStage: next.reviewStage };
  }

  /** Tells the people the step matters to; never fails the step (docs/25-notifications.md). */
  private async tell(
    content: Content,
    action: ReviewAction,
    next: ReviewTransition,
    note: string,
    user: AuthUser,
  ) {
    const about = { id: content.id, title: content.title, topicId: content.topicId };
    const actor = { id: user.id };
    const notify = (event: NotificationEvent, recipients: string[], withNote = false) =>
      this.notifications.notify({
        event,
        recipients,
        actor,
        content: about,
        note: withNote ? note : undefined,
      });

    if (action === 'submit') {
      await notify('REVIEW_SUBMITTED', await this.notifications.reviewersOf(content.topicId));
    } else if (action === 'approve' && next.reviewStage === 'FINAL') {
      await notify('REVIEW_FINAL_NEEDED', await this.notifications.admins());
    } else if (next.status === 'APPROVED') {
      await notify('REVIEW_APPROVED', await this.notifications.authorsOf(content));
    } else if (action === 'request_changes') {
      await notify('REVIEW_CHANGES_REQUESTED', await this.notifications.authorsOf(content), true);
    } else if (action === 'reject') {
      await notify('REVIEW_REJECTED', await this.notifications.authorsOf(content), true);
    }
  }

  /**
   * The text of a reviewed or approved content changed: back to DRAFT, with a history entry. Runs
   * inside the caller's transaction when it has one.
   */
  async resetAfterEdit(db: Db, contentId: string, userId: string): Promise<boolean> {
    const content = await db.content.findUnique({
      where: { id: contentId },
      select: { status: true, reviewStage: true, currentVersionId: true },
    });
    const reset = content && resetAfterEdit(content);
    if (!content || !reset) return false;
    await db.content.update({
      where: { id: contentId },
      data: {
        status: reset.status,
        reviewStage: null,
        submittedById: null,
        submittedAt: null,
        // the plan was for the approved text, which is gone
        scheduledAt: null,
      },
    });
    await db.contentReview.create({
      data: {
        contentId,
        versionId: content.currentVersionId,
        stage: reset.stage,
        decision: reset.decision,
        actorId: userId,
      },
    });
    return true;
  }
}
