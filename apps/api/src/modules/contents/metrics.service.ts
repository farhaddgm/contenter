import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BulkContentMetricsSchema,
  CreateContentMetricSchema,
  summarizeMetrics,
  UpdateContentMetricSchema,
  type BulkContentMetricsInput,
  type ContentMetric,
  type CreateContentMetricInput,
  type MetricField,
  type UpdateContentMetricInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';

const INCLUDE = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ContentMetricInclude;
type Row = Prisma.ContentMetricGetPayload<{ include: typeof INCLUDE }>;

const FIELDS: MetricField[] = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'clicks',
  'conversions',
  'revenue',
];

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

export function toMetricDto(row: Row): ContentMetric {
  return {
    id: row.id,
    contentId: row.contentId,
    measuredAt: dayOf(row.measuredAt),
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    clicks: row.clicks,
    conversions: row.conversions,
    revenue: row.revenue,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Manual performance readings of a published content (docs/32-performance-metrics.md). The admin
 * types or pastes what a platform shows; nothing here calls a platform. A published content is
 * frozen for edits, but its readings are not: they describe the post, they do not change it.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async publishedContent(contentId: string) {
    const c = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, publishedAt: true },
    });
    if (!c) throw new NotFoundException('Content not found');
    if (!c.publishedAt) {
      throw new ConflictException(
        'Mark the content as published before adding performance numbers',
      );
    }
    return c as { id: string; publishedAt: Date };
  }

  /** A reading cannot be older than the post or later than tomorrow (time zones). */
  private assertDay(day: string, publishedAt: Date) {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    if (toDate(day) > tomorrow) throw new BadRequestException('The date is in the future');
    if (day < dayOf(publishedAt)) {
      throw new BadRequestException(
        `The date is before the content was published (${dayOf(publishedAt)})`,
      );
    }
  }

  private async respond(contentId: string) {
    const rows = await this.prisma.contentMetric.findMany({
      where: { contentId },
      orderBy: { measuredAt: 'desc' },
      include: INCLUDE,
    });
    const items = rows.map(toMetricDto);
    return { items, summary: summarizeMetrics(items) };
  }

  async list(contentId: string) {
    const exists = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Content not found');
    return this.respond(contentId);
  }

  private values(input: Partial<Record<MetricField, number | null | undefined>>) {
    return Object.fromEntries(FIELDS.map((f) => [f, input[f] ?? null])) as Record<
      MetricField,
      number | null
    >;
  }

  /** Adds the reading of a day, or replaces it when that day already has one. */
  async upsert(contentId: string, input: CreateContentMetricInput, user: AuthUser) {
    const data = CreateContentMetricSchema.parse(input);
    const content = await this.publishedContent(contentId);
    const day = data.measuredAt ?? dayOf(new Date());
    this.assertDay(day, content.publishedAt);
    const values = { ...this.values(data), note: data.note ?? '' };
    await this.prisma.contentMetric.upsert({
      where: { contentId_measuredAt: { contentId, measuredAt: toDate(day) } },
      create: { contentId, measuredAt: toDate(day), createdById: user.id, ...values },
      update: values,
    });
    this.audit.log({
      userId: user.id,
      action: 'content.metric',
      entityType: 'Content',
      entityId: contentId,
      meta: { day },
    });
    return this.respond(contentId);
  }

  /** Many days at once (a pasted table). All rows are checked first; nothing is saved on error. */
  async bulk(contentId: string, input: BulkContentMetricsInput, user: AuthUser) {
    const { rows } = BulkContentMetricsSchema.parse(input);
    const content = await this.publishedContent(contentId);
    const days = new Set<string>();
    for (const r of rows) {
      this.assertDay(r.measuredAt, content.publishedAt);
      if (days.has(r.measuredAt)) {
        throw new BadRequestException(`The day ${r.measuredAt} appears twice`);
      }
      days.add(r.measuredAt);
    }
    await this.prisma.$transaction(
      rows.map((r) => {
        const values = { ...this.values(r), note: r.note ?? '' };
        return this.prisma.contentMetric.upsert({
          where: { contentId_measuredAt: { contentId, measuredAt: toDate(r.measuredAt) } },
          create: { contentId, measuredAt: toDate(r.measuredAt), createdById: user.id, ...values },
          update: values,
        });
      }),
    );
    this.audit.log({
      userId: user.id,
      action: 'content.metric_bulk',
      entityType: 'Content',
      entityId: contentId,
      meta: { rows: rows.length },
    });
    return this.respond(contentId);
  }

  async update(id: string, input: UpdateContentMetricInput, user: AuthUser) {
    const data = UpdateContentMetricSchema.parse(input);
    const row = await this.prisma.contentMetric.findUnique({
      where: { id },
      include: { content: { select: { publishedAt: true } } },
    });
    if (!row) throw new NotFoundException('Reading not found');
    if (!row.content.publishedAt) throw new ConflictException('The content is not published');
    const patch: Prisma.ContentMetricUpdateInput = {};
    for (const f of FIELDS) if (data[f] !== undefined) patch[f] = data[f];
    if (data.note !== undefined) patch.note = data.note;
    if (data.measuredAt) {
      this.assertDay(data.measuredAt, row.content.publishedAt);
      const clash = await this.prisma.contentMetric.findFirst({
        where: { contentId: row.contentId, measuredAt: toDate(data.measuredAt), NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('That day already has a reading');
      patch.measuredAt = toDate(data.measuredAt);
    }
    // the result must still hold a number
    const merged: Record<string, unknown> = { ...row, ...patch };
    if (!FIELDS.some((f) => typeof merged[f] === 'number')) {
      throw new BadRequestException('A reading needs at least one number');
    }
    await this.prisma.contentMetric.update({ where: { id }, data: patch });
    this.audit.log({
      userId: user.id,
      action: 'content.metric_update',
      entityType: 'Content',
      entityId: row.contentId,
      meta: { metricId: id },
    });
    return this.respond(row.contentId);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.prisma.contentMetric.findUnique({
      where: { id },
      select: { contentId: true, measuredAt: true },
    });
    if (!row) throw new NotFoundException('Reading not found');
    await this.prisma.contentMetric.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'content.metric_delete',
      entityType: 'Content',
      entityId: row.contentId,
      meta: { day: dayOf(row.measuredAt) },
    });
    return this.respond(row.contentId);
  }
}

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @TopicScoped('content')
  @Get('contents/:id/metrics')
  list(@Param('id') id: string) {
    return this.metrics.list(id);
  }

  @TopicScoped('content')
  @Post('contents/:id/metrics')
  add(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateContentMetricSchema)) body: CreateContentMetricInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.metrics.upsert(id, body, user);
  }

  @TopicScoped('content')
  @Post('contents/:id/metrics/bulk')
  bulk(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BulkContentMetricsSchema)) body: BulkContentMetricsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.metrics.bulk(id, body, user);
  }

  @TopicScoped('metric')
  @Patch('content-metrics/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContentMetricSchema)) body: UpdateContentMetricInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.metrics.update(id, body, user);
  }

  @TopicScoped('metric')
  @Delete('content-metrics/:id')
  @HttpCode(200)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.metrics.remove(id, user);
  }
}
