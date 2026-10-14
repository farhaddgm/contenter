import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Global,
  Injectable,
  Module,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  CoverageQuerySchema,
  SavePillarsSchema,
  buildCoverage,
  type ContentPillar,
  type CoverageQuery,
  type CoverageReport,
  type SavePillarsInput,
} from '@contenter/shared';
import { AccessService, BusinessScoped, TopicScoped } from '../../common/access';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DAY = 86_400_000;

/**
 * Content pillars and the coverage map (docs/50-coverage-map.md). Pillars are written per
 * business by people; the map only counts which pillars approved or published content covered.
 * Code only.
 */
@Injectable()
export class CoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async pillars(businessId: string): Promise<ContentPillar[]> {
    const rows = await this.prisma.contentPillar.findMany({
      where: { businessId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      targetShare: r.targetShare,
      order: r.order,
    }));
  }

  /** The pillars a content of this topic can be labeled with: its business's, or none. */
  async forTopic(topicId: string): Promise<ContentPillar[]> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { businessId: true },
    });
    return topic?.businessId ? this.pillars(topic.businessId) : [];
  }

  /** A content may only carry a pillar of its own business (400 otherwise). */
  async assertForTopic(topicId: string, pillarId: string): Promise<void> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { businessId: true },
    });
    const pillar = topic?.businessId
      ? await this.prisma.contentPillar.findFirst({
          where: { id: pillarId, businessId: topic.businessId },
          select: { id: true },
        })
      : null;
    if (!pillar) throw new BadRequestException('Pillar does not belong to this content’s business');
  }

  /**
   * Replaces the business's pillars with `input`. A pillar with an id keeps its contents even when
   * renamed; one left out is deleted and its contents become unlabeled.
   */
  async save(businessId: string, input: SavePillarsInput, user: AuthUser) {
    const data = SavePillarsSchema.parse(input);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.contentPillar.findMany({ where: { businessId } });
      const byId = new Map(existing.map((e) => [e.id, e]));
      const keep = new Set<string>();
      for (const p of data.pillars) {
        if (!p.id) continue;
        if (!byId.has(p.id))
          throw new BadRequestException('Pillar does not belong to this business');
        if (keep.has(p.id)) throw new BadRequestException('A pillar is listed twice');
        keep.add(p.id);
      }
      await tx.contentPillar.deleteMany({
        where: { businessId, id: { notIn: [...keep] } },
      });
      // park the kept names first, so renaming A→B and B→A in one save cannot hit the unique name
      for (const id of keep) {
        await tx.contentPillar.update({ where: { id }, data: { name: `~${id}` } });
      }
      let order = 0;
      for (const p of data.pillars) {
        const values = { name: p.name, targetShare: p.targetShare ?? null, order: order++ };
        if (p.id) await tx.contentPillar.update({ where: { id: p.id }, data: values });
        else await tx.contentPillar.create({ data: { businessId, ...values } });
      }
    });
    this.audit.log({
      userId: user.id,
      action: 'pillars.save',
      entityType: 'Business',
      entityId: businessId,
      meta: { count: data.pillars.length },
    });
    return this.pillars(businessId);
  }

  async coverage(
    businessId: string,
    query: CoverageQuery,
    user: AuthUser,
  ): Promise<CoverageReport> {
    const now = new Date();
    // reach back far enough to know when each pillar was last covered
    const since = new Date(now.getTime() - Math.max(query.days, query.staleDays) * DAY);
    const visible = this.access.visibleTopics(user);
    const [pillars, rows] = await Promise.all([
      this.pillars(businessId),
      this.prisma.content.findMany({
        where: {
          topic: visible ? { AND: [{ businessId }, visible] } : { businessId },
          currentVersionId: { not: null },
          AND: [
            { OR: [{ status: 'APPROVED' }, { publishedAt: { not: null } }] },
            {
              OR: [
                { publishedAt: { gte: since } },
                { scheduledAt: { gte: since } },
                { createdAt: { gte: since } },
              ],
            },
          ],
        },
        select: {
          pillarId: true,
          platform: true,
          publishedAt: true,
          scheduledAt: true,
          createdAt: true,
          topic: { select: { platform: true } },
        },
      }),
    ]);
    return buildCoverage(
      pillars,
      rows.map((r) => ({
        pillarId: r.pillarId,
        platform: r.platform ?? r.topic.platform,
        at: r.publishedAt ?? r.scheduledAt ?? r.createdAt,
      })),
      { days: query.days, by: query.by, staleDays: query.staleDays, now },
    );
  }
}

@Controller()
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/pillars')
  pillars(@Param('id') id: string) {
    return this.coverage.pillars(id);
  }

  @BusinessScoped('business')
  @Put('businesses/:id/pillars')
  save(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SavePillarsSchema)) body: SavePillarsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coverage.save(id, body, user);
  }

  @BusinessScoped('business')
  @Get('businesses/:id/coverage')
  report(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(CoverageQuerySchema)) query: CoverageQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coverage.coverage(id, query, user);
  }

  @TopicScoped('topic')
  @Get('topics/:id/pillars')
  forTopic(@Param('id') id: string) {
    return this.coverage.forTopic(id);
  }
}

@Global()
@Module({
  controllers: [CoverageController],
  providers: [CoverageService],
  exports: [CoverageService],
})
export class CoverageModule {}
