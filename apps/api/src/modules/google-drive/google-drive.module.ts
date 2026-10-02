import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public, Roles, type AuthUser } from '../../common/auth.decorators';
import { ENV, type Env } from '../../config/env';
import { DriveConnectFailure, GoogleDriveService } from './google-drive.service';

const FLOW_COOKIE = 'contenter_gdrive';
const FLOW_PATH = '/api/google-drive';

/**
 * Connected Google accounts for reading private Google Docs (docs/14-business-references.md).
 * `connect` is an authenticated XHR that sets the flow cookie and returns Google's consent URL;
 * the browser then navigates there and Google redirects to the public `callback`.
 */
@Controller('google-drive')
export class GoogleDriveController {
  private readonly logger = new Logger(GoogleDriveController.name);

  constructor(
    private readonly drive: GoogleDriveService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  status() {
    return this.drive.status();
  }

  @Post('connect')
  @Roles('ADMIN')
  @HttpCode(200)
  async connect(
    @Body() body: { redirectTo?: unknown },
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { url, flowToken } = await this.drive.start(user, body?.redirectTo);
    res.cookie(FLOW_COOKIE, flowToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.COOKIE_SECURE,
      path: FLOW_PATH,
      maxAge: this.drive.flowMaxAgeMs,
    });
    return { url };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('callback')
  async callback(
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const flowToken = req.cookies?.[FLOW_COOKIE] as string | undefined;
    res.clearCookie(FLOW_COOKIE, { path: FLOW_PATH });
    const appUrl = this.env.APP_URL.replace(/\/+$/, '');
    const back = (path: string, params: Record<string, string>) => {
      const url = new URL(`${appUrl}${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      res.redirect(302, url.toString());
    };
    try {
      const { email, redirectTo } = await this.drive.finish(query, flowToken);
      back(redirectTo, { drive: 'connected', account: email });
    } catch (err) {
      const failure = err instanceof DriveConnectFailure ? err : null;
      if (!failure || failure.code === 'failed') {
        this.logger.warn(
          `Google Drive connect failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      back(failure?.redirectTo ?? '/app', { drive: failure?.code ?? 'failed' });
    }
  }

  @Delete('accounts/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  disconnect(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.drive.disconnect(id, user);
  }
}

@Module({
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
