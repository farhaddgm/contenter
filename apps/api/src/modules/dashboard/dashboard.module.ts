import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ProductivityQuerySchema,
  type AiJobType,
  type DashboardStats,
  type ProductivityQuery,
  type ProductivityStats,
} from '@contenter/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Public, type AuthUser } from '../../common/auth.decorators';
import { AccessService } from '../../common/access';
import { QueueService } from '../../infra/queue/queue.service';
import { BackupStatusService } from '../ops/backup-status.service';
import { buildProductivity } from './productivity';

const DAYS = 14;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Admins see everything; others only their projects and the jobs they started (docs/17). */
  async stats(user: AuthUser): Promise<DashboardStats> {
    const since = new Date(Date.now() - (DAYS - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

    const visible = this.access.visibleTopics(user);
    const ids = visible
      ? (await this.prisma.topic.findMany({ where: visible, select: { id: true } })).map(
          (t) => t.id,
        )
      : null;
    const inTopics = ids ? { topicId: { in: ids } } : {};
    const jobWhere: Prisma.AiJobWhereInput = ids
      ? { OR: [{ topicId: { in: ids } }, { createdById: user.id }] }
      : {};
    // raw SQL needs the same filters; an empty IN () is invalid, so use a sentinel id
    const topicSql = ids
      ? Prisma.sql`AND "topicId" IN (${Prisma.join(ids.length ? ids : [''])})`
      : Prisma.empty;
    const jobSql = ids
      ? Prisma.sql`AND ("topicId" IN (${Prisma.join(ids.length ? ids : [''])}) OR "createdById" = ${user.id})`
      : Prisma.empty;

    const [
      topics,
      samples,
      profiles,
      ideas,
      contents,
      users,
      contentsByStatus,
      jobsByStatus,
      jobsByType,
      recentJobs,
      dailyJobs,
      dailyContents,
    ] = await Promise.all([
      this.prisma.topic.count({ where: visible }),
      this.prisma.sampleContent.count({ where: inTopics }),
      this.prisma.contentProfile.count({ where: inTopics }),
      this.prisma.idea.count({ where: inTopics }),
      this.prisma.content.count({ where: inTopics }),
      this.prisma.user.count(),
      this.prisma.content.groupBy({ by: ['status'], where: inTopics, _count: { _all: true } }),
      this.prisma.aiJob.groupBy({ by: ['status'], where: jobWhere, _count: { _all: true } }),
      this.prisma.aiJob.groupBy({
        by: ['type'],
        where: jobWhere,
        _count: { _all: true },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      }),
      this.prisma.aiJob.findMany({
        where: jobWhere,
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.$queryRaw<{ day: Date; jobs: bigint; cost: number | null }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS jobs, SUM("costUsd") AS cost
          FROM "AiJob" WHERE "createdAt" >= ${since} ${jobSql} GROUP BY 1`,
      this.prisma.$queryRaw<{ day: Date; contents: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS contents
          FROM "Content" WHERE "createdAt" >= ${since} ${topicSql} GROUP BY 1`,
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const daily = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(since.getTime() + i * 86_400_000);
      const k = key(d);
      const j = dailyJobs.find((r) => key(new Date(r.day)) === k);
      const c = dailyContents.find((r) => key(new Date(r.day)) === k);
      return {
        date: k,
        jobs: Number(j?.jobs ?? 0),
        costUsd: Number(j?.cost ?? 0),
        contents: Number(c?.contents ?? 0),
      };
    });

    const byType = jobsByType.map((r) => ({
      type: r.type as AiJobType,
      count: r._count._all,
      costUsd: r._sum.costUsd ?? 0,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
    }));

    return {
      counts: { topics, samples, profiles, ideas, contents, users },
      contentsByStatus: Object.fromEntries(contentsByStatus.map((r) => [r.status, r._count._all])),
      jobs: {
        total: jobsByStatus.reduce((s, r) => s + r._count._all, 0),
        byStatus: Object.fromEntries(jobsByStatus.map((r) => [r.status, r._count._all])),
        byType,
        totalCostUsd: byType.reduce((s, r) => s + r.costUsd, 0),
      },
      daily,
      recentJobs: recentJobs as unknown as DashboardStats['recentJobs'],
    };
  }
  /**
   * How productive the team and the AI were (docs/44-productivity-dashboard.md). Counted from
   * existing rows; limited to the topics the caller can reach, and further to one topic or business.
   */
  async productivity(user: AuthUser, query: ProductivityQuery): Promise<ProductivityStats> {
    const since = new Date(Date.now() - query.days * 86_400_000);
    const visible = this.access.visibleTopics(user);
    const narrowed = Boolean(query.topicId || query.businessId);
    const topicIds =
      visible || narrowed
        ? (
            await this.prisma.topic.findMany({
              where: {
                AND: [
                  visible ?? {},
                  query.topicId ? { id: query.topicId } : {},
                  query.businessId ? { businessId: query.businessId } : {},
                ],
              },
              select: { id: true },
            })
          ).map((t) => t.id)
        : null;
    const inTopics = topicIds ? { topicId: { in: topicIds } } : {};
    // a non-admin also sees the jobs they started that belong to no topic (as on the dashboard)
    const jobScope: Prisma.AiJobWhereInput = topicIds
      ? narrowed || user.role === 'ADMIN'
        ? { topicId: { in: topicIds } }
        : { OR: [{ topicId: { in: topicIds } }, { createdById: user.id }] }
      : {};
    const jobWhere: Prisma.AiJobWhereInput = { createdAt: { gte: since }, ...jobScope };

    const [contents, jobs, failed, retried] = await Promise.all([
      this.prisma.content.findMany({
        where: {
          status: 'APPROVED',
          ...inTopics,
          reviews: { some: { decision: 'APPROVED', createdAt: { gte: since } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
        select: {
          createdAt: true,
          currentVersion: { select: { source: true } },
          versions: { where: { source: 'AI' }, take: 1, select: { id: true } },
          reviews: {
            where: { decision: { in: ['SUBMITTED', 'APPROVED'] } },
            select: { decision: true, createdAt: true },
          },
        },
      }),
      this.prisma.aiJob.groupBy({
        by: ['type'],
        where: jobWhere,
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
      this.prisma.aiJob.groupBy({
        by: ['type'],
        where: { ...jobWhere, status: 'FAILED' },
        _count: { _all: true },
      }),
      this.prisma.aiJob.groupBy({
        by: ['type'],
        where: { ...jobWhere, attempts: { gt: 1 } },
        _count: { _all: true },
      }),
    ]);

    return buildProductivity({
      days: query.days,
      since,
      contents: contents.map((c) => ({
        createdAt: c.createdAt,
        reviews: c.reviews as { decision: 'SUBMITTED' | 'APPROVED'; createdAt: Date }[],
        // the approved text was written by a person, over an AI draft
        editedByHuman: c.currentVersion?.source === 'ADMIN' && c.versions.length > 0,
      })),
      jobs: jobs.map((j) => ({
        type: j.type as AiJobType,
        total: j._count._all,
        failed: failed.find((f) => f.type === j.type)?._count._all ?? 0,
        retried: retried.find((r) => r.type === j.type)?._count._all ?? 0,
        costUsd: j._sum.costUsd ?? 0,
      })),
    });
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  stats(@CurrentUser() user: AuthUser) {
    return this.dashboard.stats(user);
  }

  @Get('productivity')
  productivity(
    @Query(new ZodValidationPipe(ProductivityQuerySchema)) query: ProductivityQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dashboard.productivity(user, query);
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly backups: BackupStatusService,
  ) {}

  @Public()
  @Get()
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = await this.queue.ping();
    // The weekly restore check (docs/13-operations.md). Informational: it never makes `status`
    // degraded, and it is only a verdict and a date, no details.
    const restore = db
      ? await this.backups
          .summary()
          .catch(() => ({ restoreCheck: 'never' as const, lastRestoreVerifiedAt: null }))
      : { restoreCheck: 'never' as const, lastRestoreVerifiedAt: null };
    return {
      status: db && redis ? 'ok' : 'degraded',
      db,
      redis,
      ...restore,
      time: new Date().toISOString(),
    };
  }
}

@Module({
  controllers: [DashboardController, HealthController],
  providers: [DashboardService],
})
export class DashboardModule {}
