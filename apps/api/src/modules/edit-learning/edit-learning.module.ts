import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { LearningSuggestion as Row } from '@prisma/client';
import {
  AcceptLearningSuggestionSchema,
  MIN_EDIT_PAIRS,
  type AcceptLearningSuggestionInput,
  type EditCategory,
  type EditEvidence,
  type EditLearningOverview,
  type LearningSuggestion,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';
import { EDITED_APPROVED } from './edit-pairs';

const DECIDED_SHOWN = 20;

export function toSuggestion(row: Row): LearningSuggestion {
  return {
    id: row.id,
    topicId: row.topicId,
    runId: row.runId,
    kind: row.kind,
    category: row.category as EditCategory,
    text: row.text,
    rationale: row.rationale,
    evidence: (row.evidence ?? []) as unknown as EditEvidence[],
    status: row.status,
    principleId: row.principleId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Learning from the edits editors make to AI drafts (docs/30-learn-from-edits.md). The request path
 * only counts, enqueues and records the admin's decisions; the diffs and the model are in the
 * LEARN_FROM_EDITS runner.
 */
@Injectable()
export class EditLearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiJobsService,
    private readonly audit: AuditService,
  ) {}

  /** How many approved contents there are, and how many of them an editor changed. All counted. */
  private async counts(topicId: string) {
    const [approved, edited, unedited] = await Promise.all([
      this.prisma.content.count({ where: { topicId, status: 'APPROVED' } }),
      this.prisma.content.count({ where: { topicId, ...EDITED_APPROVED } }),
      this.prisma.content.count({
        where: { topicId, status: 'APPROVED', currentVersion: { is: { source: 'AI' } } },
      }),
    ]);
    return { approved, edited, unedited };
  }

  async overview(topicId: string): Promise<EditLearningOverview> {
    const [stats, activeJob, lastRun, pending, decided] = await Promise.all([
      this.counts(topicId),
      this.prisma.aiJob.findFirst({
        where: {
          type: 'LEARN_FROM_EDITS',
          targetType: 'Topic',
          targetId: topicId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      }),
      this.prisma.editLearningRun.findFirst({
        where: { topicId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.learningSuggestion.findMany({
        where: { topicId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.learningSuggestion.findMany({
        where: { topicId, status: { not: 'PENDING' } },
        orderBy: { decidedAt: 'desc' },
        take: DECIDED_SHOWN,
      }),
    ]);
    return {
      stats: {
        approved: stats.approved,
        edited: stats.edited,
        unedited: stats.unedited,
        uneditedShare: stats.approved ? stats.unedited / stats.approved : null,
      },
      minPairs: MIN_EDIT_PAIRS,
      eligible: stats.edited >= MIN_EDIT_PAIRS,
      activeJob: activeJob
        ? { id: activeJob.id, status: activeJob.status as 'QUEUED' | 'RUNNING' }
        : null,
      lastRunAt: lastRun?.createdAt.toISOString() ?? null,
      pending: pending.map(toSuggestion),
      decided: decided.map(toSuggestion),
    };
  }

  /** Queues the analysis. Code decides whether there is enough to learn from, not the model. */
  async requestAnalysis(topicId: string, user: AuthUser) {
    const { edited } = await this.counts(topicId);
    if (edited < MIN_EDIT_PAIRS) {
      throw new BadRequestException(
        `Not enough edited approved contents yet: ${edited} of ${MIN_EDIT_PAIRS} needed`,
      );
    }
    const running = await this.prisma.aiJob.findFirst({
      where: {
        type: 'LEARN_FROM_EDITS',
        targetType: 'Topic',
        targetId: topicId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: { id: true },
    });
    if (running) throw new ConflictException('An analysis of this topic is already running');
    const job = await this.ai.enqueue({
      type: 'LEARN_FROM_EDITS',
      targetType: 'Topic',
      targetId: topicId,
      topicId,
      userId: user.id,
    });
    return { jobId: job.id };
  }

  private async pendingOrThrow(id: string): Promise<Row> {
    const row = await this.prisma.learningSuggestion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Suggestion not found');
    if (row.status !== 'PENDING')
      throw new ConflictException('This suggestion was already decided');
    return row;
  }

  /** The suggestion becomes a principle of the topic, optionally reworded by the admin. */
  async accept(id: string, input: AcceptLearningSuggestionInput, user: AuthUser) {
    const row = await this.pendingOrThrow(id);
    const principle = await this.prisma.$transaction(async (tx) => {
      // a concurrent decision must not create a second principle
      const claimed = await tx.learningSuggestion.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'ACCEPTED', decidedById: user.id, decidedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('This suggestion was already decided');
      const created = await tx.principle.create({
        data: {
          topicId: row.topicId,
          kind: input.kind ?? row.kind,
          text: (input.text ?? row.text).trim(),
          order: await tx.principle.count({ where: { topicId: row.topicId } }),
        },
      });
      await tx.learningSuggestion.update({ where: { id }, data: { principleId: created.id } });
      return created;
    });
    this.audit.log({
      userId: user.id,
      action: 'learning.accept',
      entityType: 'LearningSuggestion',
      entityId: id,
      meta: { topicId: row.topicId, principleId: principle.id },
    });
    return principle;
  }

  async dismiss(id: string, user: AuthUser) {
    const row = await this.pendingOrThrow(id);
    await this.prisma.learningSuggestion.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'DISMISSED', decidedById: user.id, decidedAt: new Date() },
    });
    this.audit.log({
      userId: user.id,
      action: 'learning.dismiss',
      entityType: 'LearningSuggestion',
      entityId: id,
      meta: { topicId: row.topicId },
    });
  }
}

@Controller()
export class EditLearningController {
  constructor(private readonly learning: EditLearningService) {}

  @TopicScoped('topic')
  @Get('topics/:id/edit-learning')
  overview(@Param('id') id: string) {
    return this.learning.overview(id);
  }

  /** Queues the analysis of the topic's edited approved contents. */
  @TopicScoped('topic')
  @Post('topics/:id/edit-learning/analyze')
  @HttpCode(202)
  analyze(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.learning.requestAnalysis(id, user);
  }

  @TopicScoped('learningSuggestion')
  @Post('learning-suggestions/:id/accept')
  @HttpCode(200)
  accept(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AcceptLearningSuggestionSchema))
    body: AcceptLearningSuggestionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.learning.accept(id, body, user);
  }

  @TopicScoped('learningSuggestion')
  @Post('learning-suggestions/:id/dismiss')
  @HttpCode(204)
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.learning.dismiss(id, user);
  }
}

@Module({
  controllers: [EditLearningController],
  providers: [EditLearningService],
  exports: [EditLearningService],
})
export class EditLearningModule {}
