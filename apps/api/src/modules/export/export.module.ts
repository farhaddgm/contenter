import { Body, Controller, Module, Post, StreamableFile, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ExportContentsSchema, type ExportContentsRequest } from '@contenter/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ExportService } from './export.service';

/**
 * `POST /contents/export` (docs/55-bulk-export.md). Every role may export what it can see (it is
 * a read); an API key cannot (the route has no `@AllowApiKey`).
 */
@Controller('contents')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Post('export')
  @Roles('ADMIN', 'EDITOR', 'VIEWER')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async export(
    @Body(new ZodValidationPipe(ExportContentsSchema)) body: ExportContentsRequest,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exports.export(user, body);
    // the ASCII name is a fallback; the real, UTF-8 name is in `filename*`
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'no-store',
      'Content-Length': String(file.data.length),
    });
    return new StreamableFile(file.data);
  }
}

@Module({ controllers: [ExportController], providers: [ExportService] })
export class ExportModule {}
