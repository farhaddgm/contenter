import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClientEventsBatchSchema,
  ConversationKind,
  ErrorListQuerySchema,
  InteractionListQuerySchema,
  IssueListQuerySchema,
  ReportClientErrorSchema,
  SaveIssueSchema,
  SendSmartMessageSchema,
  SmartSettingsSchema,
  StartConversationSchema,
  UpdateErrorSchema,
  UpdateIssueSchema,
  type ClientEventsBatch,
  type ReportClientErrorInput,
  type SaveIssueInput,
  type SendSmartMessageInput,
  type SmartSettings,
  type StartConversationInput,
  type UpdateErrorInput,
  type UpdateIssueInput,
} from '@contenter/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SmartContextBuilder } from './smart-context.service';
import {
  ErrorTrackerService,
  InteractionService,
  SmartSettingsService,
  WalkerProgressService,
} from './smart-core.services';
import { ConversationsService, IssuesService } from './smart.services';

/** Endpoints every signed-in user needs (config, telemetry, client error reports). */
@Controller('smart')
@Roles('ADMIN', 'EDITOR', 'VIEWER')
export class SmartClientController {
  constructor(
    private readonly settings: SmartSettingsService,
    private readonly interactions: InteractionService,
    private readonly errors: ErrorTrackerService,
  ) {}

  @Get('config')
  config() {
    return this.settings.config();
  }

  @Post('events')
  @HttpCode(202)
  events(
    @Body(new ZodValidationPipe(ClientEventsBatchSchema)) body: ClientEventsBatch,
    @CurrentUser() user: AuthUser,
  ) {
    return this.interactions.logClient(body, user.id);
  }

  @Post('errors')
  async reportError(
    @Body(new ZodValidationPipe(ReportClientErrorSchema)) body: ReportClientErrorInput,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const id = await this.errors.record({
      source: 'CLIENT',
      message: body.message,
      detail: body.detail,
      route: body.route,
      userId: user.id,
      context: { kind: body.kind, userAgent: req.headers['user-agent'], ...(body.context ?? {}) },
    });
    return { id };
  }
}

const ConversationListQuery = z.object({
  kind: z.enum(ConversationKind).optional(),
  errorId: z.string().optional(),
});

/** Smart features for the admin: Walker, error tracker, assistant, issue log, logs. */
@Controller('smart')
@Roles('ADMIN')
export class SmartController {
  constructor(
    private readonly settings: SmartSettingsService,
    private readonly interactions: InteractionService,
    private readonly errors: ErrorTrackerService,
    private readonly walker: WalkerProgressService,
    private readonly conversations: ConversationsService,
    private readonly issues: IssuesService,
  ) {}

  // ---- walker ----
  @Get('walker/progress')
  progress(@Query('topicId') topicId?: string) {
    return this.walker.progress(topicId);
  }

  @Get('activity')
  activity(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.interactions.recentActivity(user.id, Math.min(100, Number(limit) || 30));
  }

  @Get('summary')
  async summary() {
    const [openErrors, openIssues] = await Promise.all([
      this.errors.countOpen(),
      this.issues.countOpen(),
    ]);
    return { openErrors, openIssues };
  }

  // ---- errors ----
  @Get('errors')
  listErrors(
    @Query(new ZodValidationPipe(ErrorListQuerySchema)) query: z.infer<typeof ErrorListQuerySchema>,
  ) {
    return this.errors.list(query);
  }

  @Get('errors/feed')
  feed(@Query('since') since?: string) {
    const date = since ? new Date(since) : new Date(Date.now() - 60_000);
    return this.errors.feed(Number.isNaN(date.getTime()) ? new Date(Date.now() - 60_000) : date);
  }

  @Get('errors/:id')
  getError(@Param('id') id: string) {
    return this.errors.get(id);
  }

  @Patch('errors/:id')
  updateError(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateErrorSchema)) body: UpdateErrorInput,
  ) {
    return this.errors.update(id, body.status);
  }

  // ---- assistant conversations ----
  @Get('conversations')
  listConversations(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ConversationListQuery))
    query: z.infer<typeof ConversationListQuery>,
  ) {
    return this.conversations.list(user.id, query.kind, query.errorId);
  }

  @Post('conversations')
  startConversation(
    @Body(new ZodValidationPipe(StartConversationSchema)) body: StartConversationInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.conversations.start(body, user);
  }

  @Get('conversations/:id')
  getConversation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.get(id, user);
  }

  @Post('conversations/:id/messages')
  @HttpCode(202)
  send(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendSmartMessageSchema)) body: SendSmartMessageInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.conversations.send(id, body, user);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  removeConversation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.remove(id, user);
  }

  // ---- walker issue log ----
  @Post('issues')
  saveIssue(
    @Body(new ZodValidationPipe(SaveIssueSchema)) body: SaveIssueInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.saveFromMessage(body.messageId, user);
  }

  @Get('issues')
  listIssues(
    @Query(new ZodValidationPipe(IssueListQuerySchema)) query: z.infer<typeof IssueListQuerySchema>,
  ) {
    return this.issues.list(query);
  }

  @Get('issues/:id')
  getIssue(@Param('id') id: string) {
    return this.issues.get(id);
  }

  @Patch('issues/:id')
  updateIssue(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIssueSchema)) body: UpdateIssueInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.update(id, body, user);
  }

  @Delete('issues/:id')
  @HttpCode(204)
  removeIssue(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.issues.remove(id, user);
  }

  // ---- interaction logs & settings ----
  @Get('interactions')
  listInteractions(
    @Query(new ZodValidationPipe(InteractionListQuerySchema))
    query: z.infer<typeof InteractionListQuerySchema>,
  ) {
    return this.interactions.list(query);
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  updateSettings(
    @Body(new ZodValidationPipe(SmartSettingsSchema)) body: SmartSettings,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.update(body, user.id);
  }
}

/** Global core: error tracker, interaction log, walker progress, settings, AI context. */
@Global()
@Module({
  providers: [
    SmartSettingsService,
    InteractionService,
    ErrorTrackerService,
    WalkerProgressService,
    SmartContextBuilder,
  ],
  exports: [
    SmartSettingsService,
    InteractionService,
    ErrorTrackerService,
    WalkerProgressService,
    SmartContextBuilder,
  ],
})
export class SmartCoreModule {}

@Module({
  controllers: [SmartClientController, SmartController],
  providers: [ConversationsService, IssuesService],
})
export class SmartModule {}
