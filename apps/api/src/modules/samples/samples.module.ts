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
  CreateSampleSchema,
  UpdateSampleSchema,
  type CreateSampleInput,
  type UpdateSampleInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { MediaFetcherService } from './media-fetcher.service';
import { detectPlatform } from './media-parser';
import { SamplesCoreModule } from './samples-core.module';

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: MediaFetcherService,
    private readonly jobs: AiJobsService,
    private readonly audit: AuditService,
  ) {}

  list(topicId: string) {
    return this.prisma.sampleContent.findMany({
      where: { topicId },
      include: { analysis: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const s = await this.prisma.sampleContent.findUnique({
      where: { id },
      include: { analysis: true },
    });
    if (!s) throw new NotFoundException('Sample not found');
    return s;
  }

  /** Stores the sample, fetches the link (code), and optionally queues the AI analysis. */
  async create(topicId: string, input: CreateSampleInput, user: AuthUser) {
    const data = CreateSampleSchema.parse(input);
    await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const sample = await this.prisma.sampleContent.create({
      data: {
        topicId,
        url: data.url,
        platform: detectPlatform(data.url),
        manualText: data.manualText,
        adminNote: data.adminNote,
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'sample.create',
      entityType: 'SampleContent',
      entityId: sample.id,
    });

    await this.fetcher.fetchAndStore(sample.id);
    if (data.autoAnalyze) await this.analyze(sample.id, user);
    return this.get(sample.id);
  }

  async update(id: string, input: UpdateSampleInput, user: AuthUser) {
    const s = await this.prisma.sampleContent.update({
      where: { id },
      data: input,
      include: { analysis: true },
    });
    this.audit.log({
      userId: user.id,
      action: 'sample.update',
      entityType: 'SampleContent',
      entityId: id,
    });
    return s;
  }

  async refetch(id: string, user: AuthUser) {
    await this.get(id);
    await this.fetcher.fetchAndStore(id);
    this.audit.log({
      userId: user.id,
      action: 'sample.refetch',
      entityType: 'SampleContent',
      entityId: id,
    });
    return this.get(id);
  }

  async analyze(id: string, user: AuthUser) {
    const sample = await this.get(id);
    if (sample.analysisStatus === 'QUEUED')
      throw new BadRequestException('Analysis already in progress');
    await this.prisma.sampleContent.update({ where: { id }, data: { analysisStatus: 'QUEUED' } });
    const job = await this.jobs.enqueue({
      type: 'ANALYZE_SAMPLE',
      targetType: 'SampleContent',
      targetId: id,
      topicId: sample.topicId,
      userId: user.id,
    });
    return { jobId: job.id };
  }

  async remove(id: string, user: AuthUser) {
    await this.prisma.sampleContent.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'sample.delete',
      entityType: 'SampleContent',
      entityId: id,
    });
  }
}

@Controller()
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/samples')
  list(@Param('topicId') topicId: string) {
    return this.samples.list(topicId);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/samples')
  create(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(CreateSampleSchema)) body: CreateSampleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.samples.create(topicId, body, user);
  }

  @TopicScoped('sample')
  @Get('samples/:id')
  get(@Param('id') id: string) {
    return this.samples.get(id);
  }

  @TopicScoped('sample')
  @Patch('samples/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSampleSchema)) body: UpdateSampleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.samples.update(id, body, user);
  }

  @TopicScoped('sample')
  @Post('samples/:id/refetch')
  refetch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.samples.refetch(id, user);
  }

  @TopicScoped('sample')
  @Post('samples/:id/analyze')
  @HttpCode(202)
  analyze(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.samples.analyze(id, user);
  }

  @TopicScoped('sample')
  @Delete('samples/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.samples.remove(id, user);
  }
}

@Module({
  imports: [SamplesCoreModule],
  controllers: [SamplesController],
  providers: [SamplesService],
})
export class SamplesModule {}
