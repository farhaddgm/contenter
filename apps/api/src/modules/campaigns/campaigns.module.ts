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
import {
  CreateCampaignSchema,
  UpdateCampaignSchema,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';

/** undefined = leave as is, null = clear, string = set. */
const date = (v: string | null | undefined): Date | null | undefined =>
  v ? new Date(v) : v === null ? null : undefined;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(topicId: string) {
    return this.prisma.campaign.findMany({
      where: { topicId },
      orderBy: [{ status: 'asc' }, { startsAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      include: { _count: { select: { contents: true } } },
    });
  }

  async create(topicId: string, input: CreateCampaignInput, user: AuthUser) {
    const data = CreateCampaignSchema.parse(input);
    await this.assertNameFree(topicId, data.name);
    const campaign = await this.prisma.campaign.create({
      data: {
        topicId,
        name: data.name,
        description: data.description,
        startsAt: date(data.startsAt) ?? null,
        endsAt: date(data.endsAt) ?? null,
        createdById: user.id,
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'campaign.create',
      entityType: 'Campaign',
      entityId: campaign.id,
      meta: { topicId, name: campaign.name },
    });
    return campaign;
  }

  async update(id: string, input: UpdateCampaignInput, user: AuthUser) {
    const current = await this.prisma.campaign.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Campaign not found');
    if (input.name && input.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameFree(current.topicId, input.name, id);
    }
    // a partial update can leave the stored start after the stored end
    const startsAt = input.startsAt === undefined ? current.startsAt : date(input.startsAt);
    const endsAt = input.endsAt === undefined ? current.endsAt : date(input.endsAt);
    if (startsAt && endsAt && startsAt > endsAt) {
      throw new BadRequestException('The end date cannot be before the start date');
    }
    const campaign = await this.prisma.campaign.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        startsAt: date(input.startsAt),
        endsAt: date(input.endsAt),
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'campaign.update',
      entityType: 'Campaign',
      entityId: id,
      meta: input,
    });
    return campaign;
  }

  /** Contents of the campaign stay; they just leave it (FK is SET NULL). */
  async remove(id: string, user: AuthUser) {
    await this.prisma.campaign.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'campaign.delete',
      entityType: 'Campaign',
      entityId: id,
    });
  }

  private async assertNameFree(topicId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.campaign.findFirst({
      where: {
        topicId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A campaign with this name already exists');
  }
}

@Controller()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/campaigns')
  list(@Param('topicId') topicId: string) {
    return this.campaigns.list(topicId);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/campaigns')
  create(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(CreateCampaignSchema)) body: CreateCampaignInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.campaigns.create(topicId, body, user);
  }

  @TopicScoped('campaign')
  @Patch('campaigns/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCampaignSchema)) body: UpdateCampaignInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.campaigns.update(id, body, user);
  }

  @TopicScoped('campaign')
  @Delete('campaigns/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.campaigns.remove(id, user);
  }
}

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
