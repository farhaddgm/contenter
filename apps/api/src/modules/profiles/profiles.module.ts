import {
  BadRequestException,
  Body,
  ConflictException,
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
import { Prisma } from '@prisma/client';
import {
  BuildProfileSchema,
  CreateProfileSchema,
  CreateTraitSchema,
  UpdateProfileSchema,
  UpdateTraitSchema,
  type BuildProfileInput,
  type CreateProfileInput,
  type CreateTraitInput,
  type UpdateProfileInput,
  type UpdateTraitInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/topic-access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { SettingsService } from '../settings/settings.module';

const WITH_TRAITS = {
  traits: { orderBy: [{ category: 'asc' as const }, { confidence: 'desc' as const }] },
};

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(topicId: string) {
    const topic = await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const profiles = await this.prisma.contentProfile.findMany({
      where: { topicId },
      orderBy: { version: 'desc' },
      include: { _count: { select: { traits: true } } },
    });
    return profiles.map((p) => ({ ...p, isActive: p.id === topic.activeProfileId }));
  }

  async get(id: string) {
    const p = await this.prisma.contentProfile.findUnique({
      where: { id },
      include: { ...WITH_TRAITS, activeFor: { select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Profile not found');
    const { activeFor, ...rest } = p;
    return { ...rest, isActive: !!activeFor };
  }

  async build(topicId: string, input: BuildProfileInput, user: AuthUser) {
    const { maxSamplesPerProfile } = await this.settings.getAi();
    const [analyzed, brandDocs, businessSections] = await Promise.all([
      this.prisma.sampleContent.count({
        where: {
          topicId,
          analysisStatus: 'DONE',
          ...(input.sampleIds?.length ? { id: { in: input.sampleIds } } : {}),
        },
      }),
      this.prisma.brandDocument.count({ where: { topicId, isActive: true } }),
      this.prisma.businessSection.count({
        where: { business: { topics: { some: { id: topicId } } }, content: { not: '' } },
      }),
    ]);
    if (!analyzed && !brandDocs && !businessSections)
      throw new BadRequestException(
        'Analyze at least one sample, add a brand document or link a business with a filled profile before building a profile with AI',
      );

    const sampleIds = input.sampleIds?.length
      ? input.sampleIds.slice(0, maxSamplesPerProfile)
      : (
          await this.prisma.sampleContent.findMany({
            where: { topicId, analysisStatus: 'DONE' },
            orderBy: { createdAt: 'desc' },
            take: maxSamplesPerProfile,
            select: { id: true },
          })
        ).map((s) => s.id);

    const job = await this.jobs.enqueue({
      type: 'BUILD_PROFILE',
      targetType: 'Topic',
      targetId: topicId,
      topicId,
      input: { sampleIds },
      userId: user.id,
    });
    return { jobId: job.id };
  }

  /** Creates a manual DRAFT version (no AI). Admin-written traits start APPROVED. */
  async create(topicId: string, input: CreateProfileInput, user: AuthUser) {
    const data = CreateProfileSchema.parse(input);
    await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const profile = await this.createVersion(topicId, (version) => ({
      topicId,
      version,
      status: 'DRAFT',
      summary: data.summary,
      styleGuide: data.styleGuide,
      traits: {
        create: data.traits.map((t) => ({
          ...t,
          source: 'ADMIN' as const,
          status: 'APPROVED' as const,
          confidence: 1,
        })),
      },
    }));
    this.audit.log({
      userId: user.id,
      action: 'profile.create',
      entityType: 'ContentProfile',
      entityId: profile.id,
      meta: { topicId, version: profile.version },
    });
    return this.get(profile.id);
  }

  /**
   * "New version from this one": copies any version (usually the approved/active one) into a
   * new editable DRAFT. Rejected traits are left behind; the source stays untouched.
   */
  async duplicate(id: string, user: AuthUser) {
    const source = await this.prisma.contentProfile.findUnique({
      where: { id },
      include: { traits: { where: { status: { not: 'REJECTED' } } } },
    });
    if (!source) throw new NotFoundException('Profile not found');
    const profile = await this.createVersion(source.topicId, (version) => ({
      topicId: source.topicId,
      version,
      status: 'DRAFT',
      summary: source.summary,
      styleGuide: source.styleGuide,
      sampleIds: source.sampleIds,
      brandDocIds: source.brandDocIds,
      basedOnVersion: source.version,
      traits: {
        create: source.traits.map((t) => ({
          category: t.category,
          name: t.name,
          description: t.description,
          evidence: t.evidence,
          confidence: t.confidence,
          status: t.status,
          source: t.source,
        })),
      },
    }));
    this.audit.log({
      userId: user.id,
      action: 'profile.duplicate',
      entityType: 'ContentProfile',
      entityId: profile.id,
      meta: { from: source.id, fromVersion: source.version, version: profile.version },
    });
    return this.get(profile.id);
  }

  /** Allocates the next version number; retries once if a concurrent build took it. */
  private async createVersion(
    topicId: string,
    data: (version: number) => Prisma.ContentProfileUncheckedCreateInput,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.contentProfile.findFirst({
            where: { topicId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          return tx.contentProfile.create({ data: data((last?.version ?? 0) + 1) });
        });
      } catch (e) {
        const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!conflict || attempt >= 1) throw e;
      }
    }
  }

  /** Approved and archived versions are immutable; edits go to a new version. */
  private async assertDraft(profileId: string) {
    const p = await this.prisma.contentProfile.findUnique({
      where: { id: profileId },
      select: { status: true },
    });
    if (!p) throw new NotFoundException('Profile not found');
    if (p.status !== 'DRAFT')
      throw new ConflictException(
        'Only draft profile versions can be edited. Create a new version from this one first.',
      );
  }

  private async assertTraitDraft(traitId: string) {
    const t = await this.prisma.profileTrait.findUnique({
      where: { id: traitId },
      select: { profileId: true },
    });
    if (!t) throw new NotFoundException('Trait not found');
    await this.assertDraft(t.profileId);
  }

  async update(id: string, input: UpdateProfileInput, user: AuthUser) {
    await this.assertDraft(id);
    const p = await this.prisma.contentProfile.update({ where: { id }, data: input });
    this.audit.log({
      userId: user.id,
      action: 'profile.update',
      entityType: 'ContentProfile',
      entityId: id,
    });
    return p;
  }

  /**
   * Approves a profile and makes it the topic's active profile.
   * Traits still PROPOSED are approved with it unless explicitly rejected first.
   */
  async approve(id: string, user: AuthUser) {
    const profile = await this.prisma.contentProfile.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction([
      this.prisma.profileTrait.updateMany({
        where: { profileId: id, status: 'PROPOSED' },
        data: { status: 'APPROVED' },
      }),
      this.prisma.contentProfile.updateMany({
        where: { topicId: profile.topicId, status: 'APPROVED', id: { not: id } },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.contentProfile.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
      this.prisma.topic.update({ where: { id: profile.topicId }, data: { activeProfileId: id } }),
    ]);
    this.audit.log({
      userId: user.id,
      action: 'profile.approve',
      entityType: 'ContentProfile',
      entityId: id,
      meta: { version: profile.version },
    });
    return this.get(id);
  }

  async archive(id: string, user: AuthUser) {
    const profile = await this.prisma.contentProfile.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction([
      this.prisma.contentProfile.update({ where: { id }, data: { status: 'ARCHIVED' } }),
      this.prisma.topic.updateMany({
        where: { id: profile.topicId, activeProfileId: id },
        data: { activeProfileId: null },
      }),
    ]);
    this.audit.log({
      userId: user.id,
      action: 'profile.archive',
      entityType: 'ContentProfile',
      entityId: id,
    });
    return this.get(id);
  }

  async addTrait(profileId: string, input: CreateTraitInput, user: AuthUser) {
    const data = CreateTraitSchema.parse(input);
    await this.assertDraft(profileId);
    const t = await this.prisma.profileTrait.create({
      data: { ...data, profileId, source: 'ADMIN', status: 'APPROVED', confidence: 1 },
    });
    this.audit.log({
      userId: user.id,
      action: 'trait.create',
      entityType: 'ProfileTrait',
      entityId: t.id,
    });
    return t;
  }

  async updateTrait(id: string, input: UpdateTraitInput, user: AuthUser) {
    await this.assertTraitDraft(id);
    const t = await this.prisma.profileTrait.update({ where: { id }, data: input });
    this.audit.log({
      userId: user.id,
      action: 'trait.update',
      entityType: 'ProfileTrait',
      entityId: id,
      meta: input,
    });
    return t;
  }

  async removeTrait(id: string, user: AuthUser) {
    await this.assertTraitDraft(id);
    await this.prisma.profileTrait.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'trait.delete',
      entityType: 'ProfileTrait',
      entityId: id,
    });
  }
}

@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/profiles')
  list(@Param('topicId') topicId: string) {
    return this.profiles.list(topicId);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/profiles/build')
  @HttpCode(202)
  build(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(BuildProfileSchema)) body: BuildProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.build(topicId, body, user);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/profiles')
  create(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(CreateProfileSchema)) body: CreateProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.create(topicId, body, user);
  }

  @TopicScoped('profile')
  @Post('profiles/:id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.profiles.duplicate(id, user);
  }

  @TopicScoped('profile')
  @Get('profiles/:id')
  get(@Param('id') id: string) {
    return this.profiles.get(id);
  }

  @TopicScoped('profile')
  @Patch('profiles/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.update(id, body, user);
  }

  @TopicScoped('profile')
  @Post('profiles/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.profiles.approve(id, user);
  }

  @TopicScoped('profile')
  @Post('profiles/:id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.profiles.archive(id, user);
  }

  @TopicScoped('profile')
  @Post('profiles/:id/traits')
  addTrait(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateTraitSchema)) body: CreateTraitInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.addTrait(id, body, user);
  }

  @TopicScoped('trait')
  @Patch('traits/:id')
  updateTrait(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTraitSchema)) body: UpdateTraitInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.updateTrait(id, body, user);
  }

  @TopicScoped('trait')
  @Delete('traits/:id')
  @HttpCode(204)
  removeTrait(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.profiles.removeTrait(id, user);
  }
}

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
