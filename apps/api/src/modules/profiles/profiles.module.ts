import {
  BadRequestException,
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
  BuildProfileSchema,
  CreateTraitSchema,
  UpdateProfileSchema,
  UpdateTraitSchema,
  type BuildProfileInput,
  type CreateTraitInput,
  type UpdateProfileInput,
  type UpdateTraitInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
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
    const analyzed = await this.prisma.sampleContent.count({
      where: {
        topicId,
        analysisStatus: 'DONE',
        ...(input.sampleIds?.length ? { id: { in: input.sampleIds } } : {}),
      },
    });
    if (!analyzed)
      throw new BadRequestException('Analyze at least one sample before building a profile');

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

  async update(id: string, input: UpdateProfileInput, user: AuthUser) {
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

  @Get('topics/:topicId/profiles')
  list(@Param('topicId') topicId: string) {
    return this.profiles.list(topicId);
  }

  @Post('topics/:topicId/profiles/build')
  @HttpCode(202)
  build(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(BuildProfileSchema)) body: BuildProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.build(topicId, body, user);
  }

  @Get('profiles/:id')
  get(@Param('id') id: string) {
    return this.profiles.get(id);
  }

  @Patch('profiles/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.update(id, body, user);
  }

  @Post('profiles/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.profiles.approve(id, user);
  }

  @Post('profiles/:id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.profiles.archive(id, user);
  }

  @Post('profiles/:id/traits')
  addTrait(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateTraitSchema)) body: CreateTraitInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.addTrait(id, body, user);
  }

  @Patch('traits/:id')
  updateTrait(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTraitSchema)) body: UpdateTraitInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profiles.updateTrait(id, body, user);
  }

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
