import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import {
  CreateApiKeySchema,
  type ApiKeyInfo,
  type CreateApiKeyInput,
  type CreatedApiKey,
} from '@contenter/shared';
import { API_KEY_AUTH, CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiKeysService } from './api-keys.service';
import { ApiV1Controller } from './v1.controller';
import { ContentsModule } from '../contents/contents.module';
import { CalendarModule } from '../calendar/calendar.module';
import { TopicsModule } from '../topics/topics.module';

/**
 * A person's own keys. These routes take a normal sign-in token only: a key cannot create,
 * list or revoke keys (no `@AllowApiKey`). Every role may hold keys — a VIEWER's are read-only.
 */
@Controller('api-keys')
@Roles('ADMIN', 'EDITOR', 'VIEWER')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ApiKeyInfo[]> {
    return this.keys.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyInput,
  ): Promise<CreatedApiKey> {
    return this.keys.create(user, body);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.keys.revoke(user, id);
  }
}

@Global()
@Module({
  imports: [ContentsModule, CalendarModule, TopicsModule],
  controllers: [ApiKeysController, ApiV1Controller],
  providers: [ApiKeysService, { provide: API_KEY_AUTH, useExisting: ApiKeysService }],
  exports: [ApiKeysService, API_KEY_AUTH],
})
export class ApiKeysModule {}
