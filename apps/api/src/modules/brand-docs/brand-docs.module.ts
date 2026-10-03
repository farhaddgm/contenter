import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateBrandDocSchema,
  UpdateBrandDocSchema,
  type CreateBrandDocInput,
  type TopicAiContext,
  type UpdateBrandDocInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/topic-access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';

/**
 * Topic-level brand book / writing guidelines, stored as plain text. Active documents are
 * injected by `ContextLoader.brandDocs()` into BUILD_PROFILE, IDEATE, GENERATE_CONTENT and
 * REVISE_CONTENT.
 */
@Injectable()
export class BrandDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** List without the (possibly long) text; `chars` tells the UI how big each one is. */
  async list(topicId: string) {
    const docs = await this.prisma.brandDocument.findMany({
      where: { topicId },
      orderBy: { createdAt: 'asc' },
    });
    return docs.map(({ content, ...d }) => ({ ...d, chars: content.length }));
  }

  async get(id: string) {
    const d = await this.prisma.brandDocument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Brand document not found');
    return { ...d, chars: d.content.length };
  }

  async create(topicId: string, input: CreateBrandDocInput, user: AuthUser) {
    await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const data = CreateBrandDocSchema.parse(input);
    const d = await this.prisma.brandDocument.create({
      data: { ...data, fileName: data.fileName ?? null, topicId, createdById: user.id },
    });
    this.audit.log({
      userId: user.id,
      action: 'brand_doc.create',
      entityType: 'BrandDocument',
      entityId: d.id,
      meta: { topicId, kind: d.kind, chars: d.content.length },
    });
    return { ...d, chars: d.content.length };
  }

  async update(id: string, input: UpdateBrandDocInput, user: AuthUser) {
    await this.get(id);
    const d = await this.prisma.brandDocument.update({ where: { id }, data: input });
    this.audit.log({
      userId: user.id,
      action: 'brand_doc.update',
      entityType: 'BrandDocument',
      entityId: id,
      meta: {
        kind: input.kind,
        title: input.title,
        isActive: input.isActive,
        contentChanged: input.content !== undefined,
      },
    });
    return { ...d, chars: d.content.length };
  }

  async remove(id: string, user: AuthUser) {
    await this.get(id);
    await this.prisma.brandDocument.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'brand_doc.delete',
      entityType: 'BrandDocument',
      entityId: id,
    });
  }

  /** Counts of everything the generative AI jobs of this topic receive as context. */
  async aiContext(topicId: string): Promise<TopicAiContext> {
    const topic = await this.prisma.topic.findUniqueOrThrow({
      where: { id: topicId },
      select: {
        activeProfileId: true,
        business: { select: { id: true, name: true, sections: { select: { content: true } } } },
      },
    });
    const [analyzedSamples, topicPrinciples, globalPrinciples, docs, profile] = await Promise.all([
      this.prisma.sampleContent.count({ where: { topicId, analysisStatus: 'DONE' } }),
      this.prisma.principle.count({ where: { topicId, isActive: true } }),
      this.prisma.principle.count({ where: { topicId: null, isActive: true } }),
      this.prisma.brandDocument.findMany({
        where: { topicId, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      topic.activeProfileId
        ? this.prisma.contentProfile.findFirst({
            where: { id: topic.activeProfileId, status: 'APPROVED' },
            select: {
              id: true,
              version: true,
              _count: { select: { traits: { where: { status: 'APPROVED' } } } },
            },
          })
        : null,
    ]);
    return {
      analyzedSamples,
      topicPrinciples,
      globalPrinciples,
      brandDocs: docs.map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        chars: d.content.length,
      })),
      activeProfile: profile
        ? { id: profile.id, version: profile.version, approvedTraits: profile._count.traits }
        : null,
      business: topic.business
        ? {
            id: topic.business.id,
            name: topic.business.name,
            filledSections: topic.business.sections.filter((s) => s.content.trim()).length,
          }
        : null,
    };
  }
}

@Controller()
export class BrandDocsController {
  constructor(private readonly docs: BrandDocsService) {}

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/brand-docs')
  list(@Param('topicId') topicId: string) {
    return this.docs.list(topicId);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/brand-docs')
  create(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(CreateBrandDocSchema)) body: CreateBrandDocInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.docs.create(topicId, body, user);
  }

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/ai-context')
  aiContext(@Param('topicId') topicId: string) {
    return this.docs.aiContext(topicId);
  }

  @TopicScoped('brandDoc')
  @Get('brand-docs/:id')
  get(@Param('id') id: string) {
    return this.docs.get(id);
  }

  @TopicScoped('brandDoc')
  @Patch('brand-docs/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBrandDocSchema)) body: UpdateBrandDocInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.docs.update(id, body, user);
  }

  @TopicScoped('brandDoc')
  @Delete('brand-docs/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.docs.remove(id, user);
  }
}

@Module({
  controllers: [BrandDocsController],
  providers: [BrandDocsService],
})
export class BrandDocsModule {}
