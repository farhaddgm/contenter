import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreatePromptVersionSchema,
  JobListQuerySchema,
  type CreatePromptVersionInput,
} from '@contenter/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { AccessService } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { QueueService } from '../../infra/queue/queue.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { PromptService } from '../ai/prompts/prompt.service';

const JobQuery = JobListQuerySchema.extend({ topicId: z.string().optional() });

/**
 * Any signed-in user can poll a job they started; someone else's job needs access to its topic or
 * business (docs/17).
 */
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: AiJobsService,
    private readonly access: AccessService,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const job = await this.jobs.get(id);
    if (user.role === 'ADMIN' || job.createdById === user.id) return job;
    if (job.topicId) {
      await this.access.assert(user, 'topic', job.topicId, 'VIEW');
    } else if (job.targetType === 'Business') {
      await this.access.assert(user, 'business', job.targetId, 'VIEW');
    } else if (job.targetType === 'BusinessAsset') {
      const target = await this.access.targetOf('businessAsset', job.targetId);
      if (target?.id) await this.access.assert(user, 'business', target.id, 'VIEW');
    } else {
      throw new NotFoundException('Job not found');
    }
    return job;
  }
}

@Controller('admin/jobs')
@Roles('ADMIN')
export class AdminJobsController {
  constructor(
    private readonly jobs: AiJobsService,
    private readonly queue: QueueService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(JobQuery)) query: z.infer<typeof JobQuery>) {
    return this.jobs.list(query);
  }

  @Get('queue')
  queueStats() {
    return this.queue.stats();
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.retry(id, user.id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.cancel(id, user.id);
  }
}

@Controller('admin/prompts')
@Roles('ADMIN')
export class PromptsController {
  constructor(private readonly prompts: PromptService) {}

  @Get()
  list() {
    return this.prompts.listKeys();
  }

  @Get(':key/versions')
  versions(@Param('key') key: string) {
    return this.prompts.versions(key);
  }

  @Post(':key/versions')
  create(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(CreatePromptVersionSchema)) body: CreatePromptVersionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prompts.createVersion(key, body, user.id);
  }

  @Put(':key/versions/:version/activate')
  activate(
    @Param('key') key: string,
    @Param('version') version: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prompts.activate(key, Number(version), user.id);
  }
}

@Module({
  controllers: [JobsController, AdminJobsController, PromptsController],
})
export class JobsModule {}
