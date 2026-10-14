import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Put,
  Query,
} from '@nestjs/common';
import type { AiFeedback } from '@prisma/client';
import {
  FeedbackMineQuerySchema,
  FeedbackSummaryQuerySchema,
  FeedbackTarget,
  SetFeedbackSchema,
  type AiJobType,
  type FeedbackMineQuery,
  type FeedbackReason,
  type FeedbackSummary,
  type FeedbackSummaryQuery,
  type MyFeedback,
  type SetFeedbackInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { AccessService } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { buildFeedbackSummary } from './feedback';

const toMine = (row: AiFeedback): MyFeedback => ({
  targetType: row.targetType,
  targetId: row.targetId,
  rating: row.rating,
  reason: (row.reason as FeedbackReason | null) ?? null,
  note: row.note,
  updatedAt: row.updatedAt.toISOString(),
});

const RECENT_NOTES = 20;

/**
 * 👍 / 👎 on what the AI wrote (docs/46-ai-feedback.md). One vote per person and output; whoever can
 * see the topic can vote. Votes are counted by code and never change an output by themselves.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** The topic an output belongs to and the AI job that made it. 404 when it does not exist. */
  private async resolve(
    type: FeedbackTarget,
    id: string,
  ): Promise<{ topicId: string; jobId: string | null }> {
    if (type === 'CONTENT_VERSION') {
      const v = await this.prisma.contentVersion.findUnique({
        where: { id },
        select: { source: true, jobId: true, content: { select: { topicId: true } } },
      });
      if (!v) throw new NotFoundException('Output not found');
      if (v.source !== 'AI')
        throw new BadRequestException('Only text written by the AI can be rated');
      return { topicId: v.content.topicId, jobId: v.jobId };
    }
    const p = await this.prisma.contentProfile.findUnique({
      where: { id },
      select: { topicId: true, jobId: true },
    });
    if (!p) throw new NotFoundException('Output not found');
    // a profile typed by hand has no AI job: nothing to rate
    if (!p.jobId) throw new BadRequestException('Only a profile built by the AI can be rated');
    return { topicId: p.topicId, jobId: p.jobId };
  }

  async set(user: AuthUser, type: FeedbackTarget, id: string, input: SetFeedbackInput) {
    const data = SetFeedbackSchema.parse(input);
    const target = await this.resolve(type, id);
    await this.access.assert(user, 'topic', target.topicId, 'VIEW');
    const values = {
      topicId: target.topicId,
      jobId: target.jobId,
      rating: data.rating,
      reason: data.rating === 'DOWN' ? (data.reason ?? null) : null,
      note: data.rating === 'DOWN' ? (data.note ?? '') : '',
    };
    const row = await this.prisma.aiFeedback.upsert({
      where: { userId_targetType_targetId: { userId: user.id, targetType: type, targetId: id } },
      create: { userId: user.id, targetType: type, targetId: id, ...values },
      update: values,
    });
    // the note is the person's words about a draft: it stays out of the audit log
    this.audit.log({
      userId: user.id,
      action: 'ai.feedback',
      entityType: type === 'PROFILE' ? 'ContentProfile' : 'ContentVersion',
      entityId: id,
      meta: { rating: row.rating, reason: row.reason },
    });
    return toMine(row);
  }

  /** Takes back the caller's own vote. Needs no access: it is only the caller's own row. */
  async remove(user: AuthUser, type: FeedbackTarget, id: string) {
    await this.prisma.aiFeedback.deleteMany({
      where: { userId: user.id, targetType: type, targetId: id },
    });
  }

  /** The caller's votes on one kind of output in one topic, for the buttons of a list. */
  async mine(user: AuthUser, query: FeedbackMineQuery): Promise<MyFeedback[]> {
    await this.access.assert(user, 'topic', query.topicId, 'VIEW');
    const rows = await this.prisma.aiFeedback.findMany({
      where: { userId: user.id, targetType: query.targetType, topicId: query.topicId },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return rows.map(toMine);
  }

  async summary(query: FeedbackSummaryQuery): Promise<FeedbackSummary> {
    const since = new Date(Date.now() - query.days * 86_400_000);
    const where = { createdAt: { gte: since } };
    const [votes, reasons, notes] = await Promise.all([
      this.prisma.aiFeedback.groupBy({ by: ['jobId', 'rating'], where, _count: { _all: true } }),
      this.prisma.aiFeedback.groupBy({
        by: ['reason'],
        where: { ...where, rating: 'DOWN' },
        _count: { _all: true },
      }),
      this.prisma.aiFeedback.findMany({
        where: { ...where, rating: 'DOWN', note: { not: '' } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_NOTES,
      }),
    ]);
    const jobIds = [...new Set(votes.map((v) => v.jobId).filter((j): j is string => !!j))];
    const jobs = jobIds.length
      ? await this.prisma.aiJob.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, type: true, promptKey: true, promptVersion: true, model: true },
        })
      : [];
    return buildFeedbackSummary({
      days: query.days,
      votes: votes.map((v) => ({ jobId: v.jobId, rating: v.rating, count: v._count._all })),
      jobs: jobs.map((j) => ({ ...j, type: j.type as AiJobType })),
      reasons: reasons.map((r) => ({ reason: r.reason, count: r._count._all })),
      recentNotes: notes.map((n) => ({
        id: n.id,
        targetType: n.targetType,
        targetId: n.targetId,
        topicId: n.topicId,
        reason: (n.reason as FeedbackReason | null) ?? null,
        note: n.note,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  }
}

/** Voting is open to every role that can read the topic (a viewer may say a draft is bad). */
@Controller('ai-feedback')
@Roles('ADMIN', 'EDITOR', 'VIEWER')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('mine')
  mine(
    @Query(new ZodValidationPipe(FeedbackMineQuerySchema)) query: FeedbackMineQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.mine(user, query);
  }

  @Put(':targetType/:targetId')
  set(
    @Param('targetType', new ParseEnumPipe(FeedbackTarget)) type: FeedbackTarget,
    @Param('targetId') id: string,
    @Body(new ZodValidationPipe(SetFeedbackSchema)) body: SetFeedbackInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.set(user, type, id, body);
  }

  @Delete(':targetType/:targetId')
  @HttpCode(204)
  remove(
    @Param('targetType', new ParseEnumPipe(FeedbackTarget)) type: FeedbackTarget,
    @Param('targetId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.remove(user, type, id);
  }
}

@Controller('admin/ai-feedback')
@Roles('ADMIN')
export class FeedbackAdminController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('summary')
  summary(@Query(new ZodValidationPipe(FeedbackSummaryQuerySchema)) query: FeedbackSummaryQuery) {
    return this.feedback.summary(query);
  }
}

@Module({
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
