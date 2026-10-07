import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  calendarStateOf,
  canPublish,
  effectivePlatform,
  canSchedule,
  CalendarQuerySchema,
  PublishContentSchema,
  ScheduleContentSchema,
  type CalendarItem,
  type CalendarQuery,
  type CalendarResponse,
  type PublishContentInput,
  type ScheduleContentInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { AccessService, TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { TAG_SELECT } from '../tags/tag-select';

const ITEM_SELECT = {
  id: true,
  title: true,
  format: true,
  status: true,
  scheduledAt: true,
  publishedAt: true,
  publishedUrl: true,
  platform: true,
  topic: { select: { id: true, title: true, platform: true } },
  campaign: { select: { id: true, name: true } },
  tags: { select: TAG_SELECT, orderBy: { name: 'asc' } },
} satisfies Prisma.ContentSelect;

type ItemRow = Prisma.ContentGetPayload<{ select: typeof ITEM_SELECT }>;

const READY_LIMIT = 50;
/** Publishing a little "in the future" is clock skew, not a plan. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function toItem(row: ItemRow, now: Date): CalendarItem {
  return {
    ...row,
    platform: effectivePlatform(row, row.topic),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    tags: row.tags.map((t) => ({
      ...t,
      color: t.color as CalendarItem['tags'][number]['color'],
      createdAt: t.createdAt.toISOString(),
    })),
    state: calendarStateOf(row, now),
  };
}

/** The content calendar: planning and (manual) publishing. Nothing here calls an AI. */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list(query: CalendarQuery, user: AuthUser): Promise<CalendarResponse> {
    const visible = this.access.visibleTopics(user);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const base: Prisma.ContentWhereInput = {
      ...(visible ? { topic: visible } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.tagId ? { tags: { some: { id: query.tagId } } } : {}),
    };
    const [items, ready] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where: {
          ...base,
          // a published content sits at its publication day, the rest at their plan
          OR: [
            { publishedAt: { gte: from, lt: to } },
            { publishedAt: null, scheduledAt: { gte: from, lt: to } },
          ],
        },
        orderBy: [{ publishedAt: 'asc' }, { scheduledAt: 'asc' }, { id: 'asc' }],
        select: ITEM_SELECT,
      }),
      this.prisma.content.findMany({
        where: { ...base, status: 'APPROVED', scheduledAt: null, publishedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: READY_LIMIT,
        select: ITEM_SELECT,
      }),
    ]);
    const now = new Date();
    return {
      items: items.map((r) => toItem(r, now)),
      ready: ready.map((r) => ({ ...toItem(r, now), state: null })),
    };
  }

  /** Plans (or, with null, unplans) the publication of an approved content. */
  async schedule(id: string, input: ScheduleContentInput, user: AuthUser) {
    const content = await this.load(id);
    if (input.scheduledAt && !canSchedule(content)) {
      throw new ConflictException('Only approved, unpublished content can be scheduled');
    }
    if (content.publishedAt) throw new ConflictException('The content is already published');
    const updated = await this.prisma.content.update({
      where: { id },
      data: { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null },
      select: { scheduledAt: true, publishedAt: true, publishedUrl: true },
    });
    this.audit.log({
      userId: user.id,
      action: input.scheduledAt ? 'content.schedule' : 'content.unschedule',
      entityType: 'Content',
      entityId: id,
      meta: { scheduledAt: input.scheduledAt, previous: content.scheduledAt?.toISOString() },
    });
    return updated;
  }

  /** Records that the content went live elsewhere. Publishing itself is done by people, outside. */
  async publish(id: string, input: PublishContentInput, user: AuthUser) {
    const content = await this.load(id);
    if (!canPublish(content)) {
      throw new ConflictException('Only approved, unpublished content can be marked published');
    }
    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : new Date();
    if (publishedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('The publication time cannot be in the future');
    }
    const updated = await this.prisma.content.update({
      where: { id },
      data: { publishedAt, publishedUrl: input.url ?? null },
      select: { scheduledAt: true, publishedAt: true, publishedUrl: true },
    });
    this.audit.log({
      userId: user.id,
      action: 'content.publish',
      entityType: 'Content',
      entityId: id,
      meta: { publishedAt: publishedAt.toISOString(), url: input.url },
    });
    return updated;
  }

  /** Undoes "published", which unfreezes the content. Idempotent. */
  async unpublish(id: string, user: AuthUser) {
    const content = await this.load(id);
    const updated = await this.prisma.content.update({
      where: { id },
      data: { publishedAt: null, publishedUrl: null },
      select: { scheduledAt: true, publishedAt: true, publishedUrl: true },
    });
    if (content.publishedAt) {
      this.audit.log({
        userId: user.id,
        action: 'content.unpublish',
        entityType: 'Content',
        entityId: id,
      });
    }
    return updated;
  }

  private async load(id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      select: { status: true, scheduledAt: true, publishedAt: true },
    });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }
}

@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar')
  list(
    @Query(new ZodValidationPipe(CalendarQuerySchema)) query: CalendarQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendar.list(query, user);
  }

  @TopicScoped('content')
  @Put('contents/:id/schedule')
  schedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScheduleContentSchema)) body: ScheduleContentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendar.schedule(id, body, user);
  }

  @TopicScoped('content')
  @Post('contents/:id/published')
  publish(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PublishContentSchema)) body: PublishContentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendar.publish(id, body, user);
  }

  @TopicScoped('content')
  @Delete('contents/:id/published')
  @HttpCode(200)
  unpublish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.calendar.unpublish(id, user);
  }
}

@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
