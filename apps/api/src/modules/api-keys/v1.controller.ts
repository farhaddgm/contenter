import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CalendarQuerySchema,
  ContentListQuerySchema,
  GenerateContentSchema,
  TopicListQuerySchema,
  effectivePlatform,
  type ApiV1CalendarItem,
  type ApiV1Content,
  type ApiV1ContentDetail,
  type ApiV1GenerateResult,
  type ApiV1Page,
  type ApiV1Topic,
  type CalendarQuery,
  type GenerateContentInput,
} from '@contenter/shared';
import { TopicScoped } from '../../common/access';
import { AllowApiKey, CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CalendarService } from '../calendar/calendar.module';
import { ContentsService } from '../contents/contents.module';
import { TopicsService } from '../topics/topics.module';

/** v1 lists only take the filters that are stable; anything else is ignored, not forwarded. */
const V1ContentQuery = ContentListQuerySchema.pick({
  page: true,
  pageSize: true,
  topicId: true,
  status: true,
});
const V1TopicQuery = TopicListQuerySchema.pick({ page: true, pageSize: true, status: true });
type V1ContentQuery = z.infer<typeof V1ContentQuery>;
type V1TopicQuery = z.infer<typeof V1TopicQuery>;

type ContentRow = {
  id: string;
  topicId: string;
  title: string;
  status: ApiV1Content['status'];
  format: ApiV1Content['format'];
  platform: ApiV1Content['platform'] | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  topic?: { platform: ApiV1Content['platform'] } | null;
};

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

function toContent(c: ContentRow): ApiV1Content {
  return {
    id: c.id,
    topicId: c.topicId,
    title: c.title,
    status: c.status,
    format: c.format,
    platform: c.topic ? effectivePlatform(c, c.topic) : (c.platform as ApiV1Content['platform']),
    scheduledAt: iso(c.scheduledAt),
    publishedAt: iso(c.publishedAt),
    createdAt: iso(c.createdAt)!,
    updatedAt: iso(c.updatedAt)!,
  };
}

/**
 * The public API (docs/52-api-keys.md): a small, stable surface for n8n, Zapier or a team's own
 * scripts. Every route opts in to API keys with its scope; none of them reviews, approves,
 * schedules or publishes. Fields are only ever added, never renamed or removed.
 */
@Controller('v1')
export class ApiV1Controller {
  constructor(
    private readonly contents: ContentsService,
    private readonly topics: TopicsService,
    private readonly calendar: CalendarService,
  ) {}

  @AllowApiKey('contents:read')
  @Get('topics')
  async listTopics(
    @Query(new ZodValidationPipe(V1TopicQuery)) query: V1TopicQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiV1Page<ApiV1Topic>> {
    const page = await this.topics.list(query, user);
    return {
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      items: page.items.map((t) => ({
        id: t.id,
        title: t.title,
        platform: t.platform,
        language: t.language,
        status: t.status,
        businessId: t.businessId,
      })),
    };
  }

  @AllowApiKey('contents:read')
  @Get('contents')
  async listContents(
    @Query(new ZodValidationPipe(V1ContentQuery)) query: V1ContentQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiV1Page<ApiV1Content>> {
    const page = await this.contents.list(ContentListQuerySchema.parse(query), user);
    return {
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      items: page.items.map((c) => toContent(c as unknown as ContentRow)),
    };
  }

  @AllowApiKey('contents:read')
  @TopicScoped('content')
  @Get('contents/:id')
  async getContent(@Param('id') id: string): Promise<ApiV1ContentDetail> {
    const c = await this.contents.get(id);
    const v = c.currentVersion;
    return {
      ...toContent(c as unknown as ContentRow),
      text: v ? { title: v.title, body: v.body, hashtags: v.hashtags, cta: v.cta } : null,
    };
  }

  /** Queues drafts like the app does; the AI runs in the worker, and the result is read with `GET /v1/contents/:id`. */
  @AllowApiKey('contents:write')
  @TopicScoped('topic')
  @Post('topics/:id/contents/generate')
  async generate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GenerateContentSchema)) body: GenerateContentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiV1GenerateResult> {
    const r = await this.contents.generate(id, body, user);
    return { contentId: r.contentId, jobId: r.jobId };
  }

  @AllowApiKey('calendar:read')
  @Get('calendar')
  async calendarItems(
    @Query(new ZodValidationPipe(CalendarQuerySchema)) query: CalendarQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<{ items: ApiV1CalendarItem[] }> {
    const res = await this.calendar.list(query, user);
    return {
      items: res.items.map((i) => ({
        id: i.id,
        topicId: i.topic.id,
        title: i.title,
        status: i.status,
        format: i.format,
        platform: i.platform,
        scheduledAt: i.scheduledAt,
        publishedAt: i.publishedAt,
      })),
    };
  }
}
