import {
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  Module,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  NotificationEvent,
  NotificationListQuerySchema,
  NotificationSettingsSchema,
  PaginationQuerySchema,
  SetNotificationPreferenceSchema,
  type NotificationSettingsInput,
  type SetNotificationPreferenceInput,
} from '@contenter/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InboxService } from './inbox.service';
import { MailerService } from './mailer.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsService } from './notifications.service';
import { ContentReminderService } from './reminder.service';
import { WebhookService } from './webhook.service';

/**
 * The signed-in user's own notifications. Static paths come before `:id`. Every role may read and
 * change its own notifications and preferences: they are not content, so the VIEWER role's
 * read-only default (RolesGuard) does not apply.
 */
@Controller('notifications')
@Roles('ADMIN', 'EDITOR', 'VIEWER')
export class NotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(NotificationListQuerySchema))
    query: z.infer<typeof NotificationListQuerySchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inbox.list(user.id, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.inbox.unreadCount(user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.inbox.markAllRead(user.id);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.inbox.preferences(user.id);
  }

  @Put('preferences/:event')
  setPreference(
    @Param('event', new ParseEnumPipe(NotificationEvent)) event: NotificationEvent,
    @Body(new ZodValidationPipe(SetNotificationPreferenceSchema))
    body: SetNotificationPreferenceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inbox.setPreference(user.id, event, body);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inbox.markRead(user.id, id);
  }
}

/** The webhook and the e-mail status, for admins. */
@Controller('admin')
@Roles('ADMIN')
export class NotificationAdminController {
  constructor(
    private readonly settings: NotificationSettingsService,
    private readonly inbox: InboxService,
  ) {}

  @Get('settings/notifications')
  get() {
    return this.settings.get();
  }

  @Put('settings/notifications')
  update(
    @Body(new ZodValidationPipe(NotificationSettingsSchema)) body: NotificationSettingsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.update(body, user.id);
  }

  @Post('settings/notifications/test')
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser) {
    return this.inbox.sendTest(user);
  }

  @Get('notification-deliveries')
  deliveries(
    @Query(new ZodValidationPipe(PaginationQuerySchema))
    query: z.infer<typeof PaginationQuerySchema>,
  ) {
    return this.inbox.deliveries(query);
  }
}

@Global()
@Module({
  controllers: [NotificationsController, NotificationAdminController],
  providers: [
    NotificationsService,
    MailerService,
    WebhookService,
    NotificationSettingsService,
    InboxService,
    ContentReminderService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
