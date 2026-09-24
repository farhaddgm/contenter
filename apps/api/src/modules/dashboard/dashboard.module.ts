import { Controller, Get, Injectable, Module } from '@nestjs/common';
import type { AiJobType, DashboardStats } from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Public } from '../../common/auth.decorators';
import { QueueService } from '../../infra/queue/queue.service';

const DAYS = 14;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(): Promise<DashboardStats> {
    const since = new Date(Date.now() - (DAYS - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

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
      this.prisma.topic.count(),
      this.prisma.sampleContent.count(),
      this.prisma.contentProfile.count(),
      this.prisma.idea.count(),
      this.prisma.content.count(),
      this.prisma.user.count(),
      this.prisma.content.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.aiJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.aiJob.groupBy({
        by: ['type'],
        _count: { _all: true },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      }),
      this.prisma.aiJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.$queryRaw<{ day: Date; jobs: bigint; cost: number | null }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS jobs, SUM("costUsd") AS cost
          FROM "AiJob" WHERE "createdAt" >= ${since} GROUP BY 1`,
      this.prisma.$queryRaw<{ day: Date; contents: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS contents
          FROM "Content" WHERE "createdAt" >= ${since} GROUP BY 1`,
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
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  stats() {
    return this.dashboard.stats();
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get()
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = await this.queue.ping();
    return { status: db && redis ? 'ok' : 'degraded', db, redis, time: new Date().toISOString() };
  }
}

@Module({
  controllers: [DashboardController, HealthController],
  providers: [DashboardService],
})
export class DashboardModule {}
