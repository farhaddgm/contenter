import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApplyChatSchema,
  SendChatMessageSchema,
  type ApplyChatInput,
  type SendChatMessageInput,
} from '@contenter/shared';
import { BusinessScoped } from '../../common/access';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BusinessChatService } from './business-chat.service';

/** The admin's conversation about a business profile — docs/75-business-chat.md. */
@Controller()
export class BusinessChatController {
  constructor(private readonly chats: BusinessChatService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/chat')
  async current(@Param('id') id: string) {
    return { chat: await this.chats.current(id) };
  }

  @BusinessScoped('business')
  @Post('businesses/:id/chat/messages')
  send(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendChatMessageSchema)) body: SendChatMessageInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chats.send(id, body, user);
  }

  @BusinessScoped('businessChat')
  @Post('business-chats/:id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chats.retry(id, user);
  }

  @BusinessScoped('businessChat')
  @Post('business-chats/:id/digest')
  digest(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chats.requestDigest(id, user);
  }

  @BusinessScoped('businessChat')
  @Post('business-chats/:id/apply')
  apply(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApplyChatSchema)) body: ApplyChatInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chats.apply(id, body, user);
  }

  @BusinessScoped('businessChat')
  @Delete('business-chats/:id')
  @HttpCode(204)
  discard(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chats.discard(id, user);
  }
}
