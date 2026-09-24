import { Body, Controller, Get, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  CreatePromptVersionSchema,
  JobListQuerySchema,
  type CreatePromptVersionInput,
} from '@contenter/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { QueueService } from '../../infra/queue/queue.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { PromptService } from '../ai/prompts/prompt.service';

const JobQuery = JobListQuerySchema.extend({ topicId: z.string().optional() });

/** Any signed-in user can poll a job they triggered. */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: AiJobsService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.get(id);
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
