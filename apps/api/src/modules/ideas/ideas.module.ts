import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IdeaListQuerySchema,
  IdeateSchema,
  UpdateIdeaSchema,
  type IdeateInput,
  type UpdateIdeaInput,
} from '@contenter/shared';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/topic-access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AiJobsService } from '../ai/ai-jobs.service';

@Injectable()
export class IdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobsService,
    private readonly audit: AuditService,
  ) {}

  async list(topicId: string, query: z.infer<typeof IdeaListQuerySchema>) {
    const where: Prisma.IdeaWhereInput = {
      topicId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.idea.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { score: 'desc' }],
        ...paginate(query),
      }),
      this.prisma.idea.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Records the ideation request and queues the AI job. */
  async ideate(topicId: string, input: IdeateInput, user: AuthUser) {
    const data = IdeateSchema.parse(input);
    await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const request = await this.prisma.ideationRequest.create({
      data: {
        topicId,
        count: data.count,
        direction: data.direction,
        format: data.format ?? null,
        createdById: user.id,
      },
    });
    const job = await this.jobs.enqueue({
      type: 'IDEATE',
      targetType: 'IdeationRequest',
      targetId: request.id,
      topicId,
      input: data,
      userId: user.id,
    });
    await this.prisma.ideationRequest.update({
      where: { id: request.id },
      data: { jobId: job.id },
    });
    return { jobId: job.id, requestId: request.id };
  }

  async update(id: string, input: UpdateIdeaInput, user: AuthUser) {
    const idea = await this.prisma.idea.update({ where: { id }, data: input });
    this.audit.log({
      userId: user.id,
      action: 'idea.update',
      entityType: 'Idea',
      entityId: id,
      meta: input,
    });
    return idea;
  }

  async remove(id: string, user: AuthUser) {
    await this.prisma.idea.delete({ where: { id } });
    this.audit.log({ userId: user.id, action: 'idea.delete', entityType: 'Idea', entityId: id });
  }
}

@Controller()
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/ideas')
  list(
    @Param('topicId') topicId: string,
    @Query(new ZodValidationPipe(IdeaListQuerySchema)) query: z.infer<typeof IdeaListQuerySchema>,
  ) {
    return this.ideas.list(topicId, query);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/ideas/generate')
  @HttpCode(202)
  ideate(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(IdeateSchema)) body: IdeateInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ideas.ideate(topicId, body, user);
  }

  @TopicScoped('idea')
  @Patch('ideas/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIdeaSchema)) body: UpdateIdeaInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ideas.update(id, body, user);
  }

  @TopicScoped('idea')
  @Delete('ideas/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ideas.remove(id, user);
  }
}

@Module({
  controllers: [IdeasController],
  providers: [IdeasService],
})
export class IdeasModule {}
