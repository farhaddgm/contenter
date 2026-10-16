import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { SetGoldenSchema, type GoldenList, type SetGoldenInput } from '@contenter/shared';
import { AccessService, BusinessScoped, TopicScoped } from '../../common/access';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.module';

const EXCERPT_CHARS = 240;

/**
 * Golden examples (docs/49-golden-examples.md): an admin marks approved content as the brand's
 * voice; `ContextLoader.goldenExamples` picks from them when a draft is written. Marking is code
 * only; the mark is dropped when the text changes (`ReviewsService.resetAfterEdit`).
 */
@Injectable()
export class GoldenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
  ) {}

  async set(contentId: string, input: SetGoldenInput, user: AuthUser) {
    const c = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        status: true,
        publishedAt: true,
        currentVersionId: true,
        goldenAt: true,
        topic: { select: { businessId: true } },
      },
    });
    if (!c) throw new NotFoundException('Content not found');
    if (input.golden) {
      if (!c.topic.businessId) {
        throw new ConflictException('Only content of a project with a business can be an example');
      }
      if (!c.currentVersionId || (c.status !== 'APPROVED' && !c.publishedAt)) {
        throw new ConflictException('Only approved or published content can be an example');
      }
    }
    if (input.golden === !!c.goldenAt) return { goldenAt: c.goldenAt };
    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: { goldenAt: input.golden ? new Date() : null },
      select: { goldenAt: true },
    });
    this.audit.log({
      userId: user.id,
      action: input.golden ? 'content.golden' : 'content.golden_remove',
      entityType: 'Content',
      entityId: contentId,
    });
    return updated;
  }

  /** The business's golden contents the caller can see, newest mark first. */
  async list(businessId: string, user: AuthUser): Promise<GoldenList> {
    const visible = this.access.visibleTopics(user);
    const [rows, { maxExamples, maxChars }] = await Promise.all([
      this.prisma.content.findMany({
        where: {
          goldenAt: { not: null },
          topic: visible ? { AND: [{ businessId }, visible] } : { businessId },
        },
        orderBy: { goldenAt: 'desc' },
        take: 100,
        select: {
          id: true,
          topicId: true,
          title: true,
          platform: true,
          format: true,
          status: true,
          publishedAt: true,
          goldenAt: true,
          topic: { select: { platform: true } },
          currentVersion: { select: { body: true } },
        },
      }),
      this.settings.getGolden(),
    ]);
    return {
      maxExamples,
      maxChars,
      items: rows.flatMap((r) =>
        r.goldenAt
          ? [
              {
                id: r.id,
                topicId: r.topicId,
                title: r.title,
                platform: r.platform ?? r.topic.platform,
                format: r.format,
                goldenAt: r.goldenAt.toISOString(),
                excerpt: (r.currentVersion?.body ?? '').slice(0, EXCERPT_CHARS),
                eligible: !!r.currentVersion && (r.status === 'APPROVED' || !!r.publishedAt),
              },
            ]
          : [],
      ),
    };
  }
}

@Controller()
export class GoldenController {
  constructor(private readonly golden: GoldenService) {}

  @Roles('ADMIN')
  @TopicScoped('content')
  @Put('contents/:id/golden')
  set(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetGoldenSchema)) body: SetGoldenInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.golden.set(id, body, user);
  }

  @BusinessScoped('business')
  @Get('businesses/:id/golden')
  list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.golden.list(id, user);
  }
}

@Module({ controllers: [GoldenController], providers: [GoldenService] })
export class GoldenModule {}
