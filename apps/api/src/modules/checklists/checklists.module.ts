import { randomUUID } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SaveChecklistsSchema,
  ToggleChecklistItemSchema,
  checklistItemsFor,
  effectivePlatform,
  requiredOpenCount,
  type ChecklistItem,
  type ChecklistTemplate,
  type ContentChecklist,
  type ContentChecklistItem,
  type QualityReport,
  type SaveChecklistsInput,
  type ToggleChecklistItemInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped, TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';

/** The Prisma delegates the tick code touches, so it also runs inside a transaction. */
export type TickDb = Pick<Prisma.TransactionClient, 'contentChecklistTick'>;

const newItemId = () => randomUUID().slice(0, 8);

const toItem = (raw: unknown): ChecklistItem[] =>
  (Array.isArray(raw) ? raw : []).flatMap((r: Partial<ChecklistItem>) =>
    r && typeof r.id === 'string' && typeof r.text === 'string'
      ? [{ id: r.id, text: r.text, required: !!r.required, auto: r.auto ?? null }]
      : [],
  );

/**
 * The publishing checklist (docs/45-publish-checklist.md): the points are written per business,
 * ticked per content by people, and an open required point stops the content from being scheduled.
 * Code only. The points a person cannot tick (`auto`) are answered by the quality gate.
 */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async templates(businessId: string): Promise<ChecklistTemplate[]> {
    const rows = await this.prisma.checklistTemplate.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ platform: r.platform, items: toItem(r.items) }));
  }

  /** Replaces the business's checklists with `input`. Points keep their id, so ticks survive an edit. */
  async save(businessId: string, input: SaveChecklistsInput, user: AuthUser) {
    const data = SaveChecklistsSchema.parse(input);
    const wanted = data.templates
      .map((t) => ({
        platform: t.platform,
        items: t.items.map((i) => ({
          id: i.id ?? newItemId(),
          text: i.text,
          required: i.required,
          auto: i.auto,
        })),
      }))
      .filter((t) => t.items.length > 0);
    if (wanted.some((t) => new Set(t.items.map((i) => i.id)).size !== t.items.length)) {
      throw new ConflictException('Two points of a checklist share one id');
    }
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.checklistTemplate.findMany({ where: { businessId } });
      for (const row of existing) {
        if (!wanted.some((w) => w.platform === row.platform)) {
          await tx.checklistTemplate.delete({ where: { id: row.id } });
        }
      }
      for (const w of wanted) {
        const row = existing.find((e) => e.platform === w.platform);
        const items = w.items as unknown as Prisma.InputJsonValue;
        if (row) {
          await tx.checklistTemplate.update({
            where: { id: row.id },
            data: { items, updatedById: user.id },
          });
        } else {
          await tx.checklistTemplate.create({
            data: { businessId, platform: w.platform, items, updatedById: user.id },
          });
        }
      }
    });
    this.audit.log({
      userId: user.id,
      action: 'checklist.save',
      entityType: 'Business',
      entityId: businessId,
      meta: { templates: wanted.length, items: wanted.reduce((n, t) => n + t.items.length, 0) },
    });
    return this.templates(businessId);
  }

  /**
   * The checklist of a content with its state, or null when its business has none (or it has no
   * business). `quality` answers the automatic points; without it they are shown as not done.
   */
  async forContent(
    contentId: string,
    quality?: Pick<QualityReport, 'warnings'> | null,
  ): Promise<ContentChecklist | null> {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        platform: true,
        topic: { select: { platform: true, businessId: true } },
        checklistTicks: {
          select: { itemId: true, createdAt: true, checkedBy: { select: { name: true } } },
        },
      },
    });
    if (!content?.topic.businessId) return null;
    const templates = await this.templates(content.topic.businessId);
    const defs = checklistItemsFor(templates, effectivePlatform(content, content.topic));
    if (!defs.length) return null;
    const ticks = new Map(content.checklistTicks.map((t) => [t.itemId, t]));
    const items: ContentChecklistItem[] = defs.map((d) => {
      if (d.auto) {
        return {
          ...d,
          checked: !!quality && quality.warnings === 0,
          checkedAt: null,
          checkedByName: null,
        };
      }
      const tick = ticks.get(d.id);
      return {
        ...d,
        checked: !!tick,
        checkedAt: tick?.createdAt.toISOString() ?? null,
        checkedByName: tick?.checkedBy?.name ?? null,
      };
    });
    return { items, requiredOpen: requiredOpenCount(items) };
  }

  /** Ticks or unticks one point. Automatic points cannot be ticked; a published content is frozen. */
  async toggle(contentId: string, itemId: string, input: ToggleChecklistItemInput, user: AuthUser) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { publishedAt: true },
    });
    if (!content) throw new NotFoundException('Content not found');
    if (content.publishedAt) throw new ConflictException('The content is already published');
    const checklist = await this.forContent(contentId);
    const item = checklist?.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('This point is not in the checklist of the content');
    if (item.auto) throw new ConflictException('This point is checked automatically');
    if (input.checked) {
      await this.prisma.contentChecklistTick.upsert({
        where: { contentId_itemId: { contentId, itemId } },
        create: { contentId, itemId, checkedById: user.id },
        update: {},
      });
    } else {
      await this.prisma.contentChecklistTick.deleteMany({ where: { contentId, itemId } });
    }
    this.audit.log({
      userId: user.id,
      action: input.checked ? 'content.checklist_check' : 'content.checklist_uncheck',
      entityType: 'Content',
      entityId: contentId,
      meta: { itemId },
    });
  }

  /** Scheduling needs every required point ticked. Answers 409 with how many are open. */
  async assertReady(contentId: string): Promise<void> {
    const checklist = await this.forContent(contentId);
    if (checklist && checklist.requiredOpen > 0) {
      throw new ConflictException(
        `${checklist.requiredOpen} required checklist point(s) are not done yet`,
      );
    }
  }

  /** The reviewed text changed: what people confirmed about it no longer holds. */
  async clearTicks(db: TickDb, contentId: string): Promise<void> {
    await db.contentChecklistTick.deleteMany({ where: { contentId } });
  }
}

@Controller()
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/checklists')
  list(@Param('id') id: string) {
    return this.checklists.templates(id);
  }

  @BusinessScoped('business')
  @Put('businesses/:id/checklists')
  save(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaveChecklistsSchema)) body: SaveChecklistsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.checklists.save(id, body, user);
  }

  @TopicScoped('content')
  @Put('contents/:id/checklist/:itemId')
  @HttpCode(204)
  toggle(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(ToggleChecklistItemSchema)) body: ToggleChecklistItemInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.checklists.toggle(id, itemId, body, user);
  }
}

@Global()
@Module({
  controllers: [ChecklistsController],
  providers: [ChecklistsService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
