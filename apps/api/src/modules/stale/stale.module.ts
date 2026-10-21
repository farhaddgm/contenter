import { Controller, Get, Injectable, Module, Param } from '@nestjs/common';
import {
  STALE_MAX_CONTENTS,
  effectivePlatform,
  findStale,
  type StaleReport,
} from '@contenter/shared';
import { AccessService, BusinessScoped } from '../../common/access';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Approved or published contents of a business whose text clashes with a key fact that changed or
 * expired (docs/61-occasions-register-stale.md). Same code as the quality gate; no model.
 */
@Injectable()
export class StaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async forBusiness(businessId: string, user: AuthUser): Promise<StaleReport> {
    const facts = await this.prisma.businessFact.findMany({
      where: { businessId, isActive: true },
      select: { label: true, value: true, validUntil: true },
    });
    if (!facts.length) return { checked: 0, truncated: false, items: [] };
    const visible = this.access.visibleTopics(user);
    const rows = await this.prisma.content.findMany({
      where: {
        topic: visible ? { AND: [{ businessId }, visible] } : { businessId },
        currentVersionId: { not: null },
        OR: [{ status: 'APPROVED' }, { publishedAt: { not: null } }],
      },
      orderBy: { updatedAt: 'desc' },
      take: STALE_MAX_CONTENTS + 1,
      select: {
        id: true,
        status: true,
        format: true,
        platform: true,
        publishedAt: true,
        scheduledAt: true,
        topic: { select: { id: true, title: true, platform: true } },
        currentVersion: { select: { title: true, body: true, hashtags: true, cta: true } },
      },
    });
    const truncated = rows.length > STALE_MAX_CONTENTS;
    const used = rows.slice(0, STALE_MAX_CONTENTS);
    const items = findStale(
      used.flatMap((r) =>
        r.currentVersion
          ? [
              {
                id: r.id,
                title: r.currentVersion.title,
                status: r.status,
                platform: effectivePlatform(r, r.topic),
                format: r.format,
                publishedAt: r.publishedAt?.toISOString() ?? null,
                scheduledAt: r.scheduledAt?.toISOString() ?? null,
                topic: { id: r.topic.id, title: r.topic.title },
                versionTitle: r.currentVersion.title,
                body: r.currentVersion.body,
                hashtags: r.currentVersion.hashtags,
                cta: r.currentVersion.cta,
              },
            ]
          : [],
      ),
      facts,
    );
    return { checked: used.length, truncated, items };
  }
}

@Controller()
export class StaleController {
  constructor(private readonly stale: StaleService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/stale-contents')
  report(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.stale.forBusiness(id, user);
  }
}

@Module({ controllers: [StaleController], providers: [StaleService] })
export class StaleModule {}
