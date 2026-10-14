import {
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  PLATFORM_RULES,
  analyzeReadability,
  checkContentQuality,
  effectivePlatform,
  fingerprint,
  isVariantAngle,
  planPick,
  similarityScore,
  type PickRefusal,
  type VariantGroup,
  type VariantItem,
} from '@contenter/shared';
import { TopicScoped } from '../../common/access';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.module';

/** What the review history says about a draft that was not chosen. */
export const NOT_CHOSEN_NOTE = 'Not chosen among the drafts written together for one idea';

const REFUSALS: Record<PickRefusal, string> = {
  not_in_group: 'This content is not part of the group',
  not_draft: 'Only a draft with text can be chosen',
  still_generating: 'Another draft of the group is still being written; wait until it is done',
};

/**
 * Drafts written together for one idea (docs/51-draft-variants.md): the compare page and the
 * choice. Every number is computed by code; choosing sends the other drafts to REJECTED (which
 * `reopen` undoes) instead of deleting them.
 */
@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  limit() {
    return this.settings.getVariants();
  }

  /** The group the content belongs to (a lone content is a group of one). */
  async group(contentId: string): Promise<VariantGroup> {
    const base = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, topicId: true, variantGroupId: true },
    });
    if (!base) throw new NotFoundException('Content not found');
    const rows = await this.prisma.content.findMany({
      where: base.variantGroupId
        ? { variantGroupId: base.variantGroupId, topicId: base.topicId }
        : { id: contentId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        platform: true,
        format: true,
        variantAngle: true,
        topic: { select: { platform: true } },
        currentVersion: { select: { title: true, body: true, hashtags: true, cta: true } },
      },
    });
    const readSettings = await this.settings.getReadability();
    const prints = rows.map((r) =>
      fingerprint(`${r.currentVersion?.title ?? ''}\n${r.currentVersion?.body ?? ''}`),
    );
    const items: VariantItem[] = rows.map((r, i) => {
      const v = r.currentVersion;
      const platform = effectivePlatform(r, r.topic);
      const quality = v
        ? checkContentQuality({
            title: v.title,
            body: v.body,
            hashtags: v.hashtags,
            cta: v.cta,
            platform,
            format: r.format,
          })
        : null;
      const read = v
        ? analyzeReadability({ body: v.body, cta: v.cta, platform, settings: readSettings })
        : null;
      const others = prints.filter((_, j) => j !== i && prints[j]!.words > 0);
      return {
        id: r.id,
        status: r.status,
        angle: isVariantAngle(r.variantAngle) ? r.variantAngle : null,
        title: v?.title ?? '',
        body: v?.body ?? '',
        hashtags: v?.hashtags ?? [],
        cta: v?.cta ?? '',
        length: quality?.length ?? 0,
        maxChars: PLATFORM_RULES[platform].maxChars ?? null,
        warnings: quality?.warnings ?? 0,
        avgSentenceWords: read?.metrics.avgSentenceWords ?? 0,
        readabilityNotes: read?.notes.length ?? 0,
        similarTo:
          others.length && prints[i]!.words > 0
            ? Math.round(Math.max(...others.map((o) => similarityScore(prints[i]!, o))) * 100) / 100
            : null,
      };
    });
    return { groupId: base.variantGroupId, topicId: base.topicId, items };
  }

  async pick(contentId: string, user: AuthUser): Promise<VariantGroup> {
    const group = await this.group(contentId);
    const plan = planPick(
      group.items.map((i) => ({ id: i.id, status: i.status, hasVersion: i.body.length > 0 })),
      contentId,
    );
    if (!plan.ok) throw new ConflictException(REFUSALS[plan.reason]);
    if (plan.reject.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const id of plan.reject) {
          const row = await tx.content.update({
            where: { id },
            data: { status: 'REJECTED', reviewStage: null, scheduledAt: null },
            select: { currentVersionId: true },
          });
          await tx.contentReview.create({
            data: {
              contentId: id,
              versionId: row.currentVersionId,
              stage: null,
              decision: 'REJECTED',
              actorId: user.id,
              note: NOT_CHOSEN_NOTE,
            },
          });
        }
      });
    }
    this.audit.log({
      userId: user.id,
      action: 'content.variant_pick',
      entityType: 'Content',
      entityId: contentId,
      meta: { groupId: group.groupId, rejected: plan.reject, kept: plan.keep },
    });
    return this.group(contentId);
  }
}

@Controller()
export class VariantsController {
  constructor(private readonly variants: VariantsService) {}

  /** How many drafts one request may ask for, so the dialog offers only those. */
  @TopicScoped('topic')
  @Get('topics/:id/variant-limit')
  limit() {
    return this.variants.limit();
  }

  @TopicScoped('content')
  @Get('contents/:id/variants')
  list(@Param('id') id: string) {
    return this.variants.group(id);
  }

  @TopicScoped('content')
  @Post('contents/:id/variants/pick')
  pick(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.variants.pick(id, user);
  }
}

@Module({ controllers: [VariantsController], providers: [VariantsService] })
export class VariantsModule {}
