import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ChangePasswordSchema,
  LoginSchema,
  type AuthProviders,
  type ChangePasswordInput,
  type LoginInput,
} from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { CurrentUser, Public, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService, type SessionMeta } from './auth.service';
import { GoogleAuthError, GoogleOAuthService } from './google-oauth.service';

const REFRESH_COOKIE = 'contenter_rt';
const GOOGLE_FLOW_COOKIE = 'contenter_goauth';
const GOOGLE_FLOW_PATH = '/api/auth/google';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleOAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get('providers')
  providers(): AuthProviders {
    return { google: this.google.enabled };
  }

  /** Browser navigation target: redirects to Google's account chooser. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('google')
  async googleStart(@Query('redirectTo') redirectTo: string | undefined, @Res() res: Response) {
    try {
      const { url, flowToken } = await this.google.start(redirectTo);
      res.cookie(GOOGLE_FLOW_COOKIE, flowToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.env.COOKIE_SECURE,
        path: GOOGLE_FLOW_PATH,
        maxAge: this.google.flowMaxAgeMs,
      });
      res.redirect(302, url);
    } catch (err) {
      this.googleFailed(res, err);
    }
  }

  /** Google redirects here; on success the refresh cookie is set and the app restores the session. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('google/callback')
  async googleCallback(
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const flowToken = req.cookies?.[GOOGLE_FLOW_COOKIE] as string | undefined;
    res.clearCookie(GOOGLE_FLOW_COOKIE, { path: GOOGLE_FLOW_PATH });
    try {
      const { identity, redirectTo } = await this.google.finish(query, flowToken);
      const result = await this.auth.loginWithGoogle(identity, this.meta(req));
      this.setCookie(res, result.refreshToken, result.refreshExpiresAt);
      res.redirect(302, `${this.appUrl}${redirectTo}`);
    } catch (err) {
      this.googleFailed(res, err);
    }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, this.meta(req));
    this.setCookie(res, result.refreshToken, result.refreshExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.meta(req));
    this.setCookie(res, result.refreshToken, result.refreshExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput,
  ) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  private get appUrl() {
    return this.env.APP_URL.replace(/\/+$/, '');
  }

  private googleFailed(res: Response, err: unknown) {
    const code = err instanceof GoogleAuthError ? err.code : 'failed';
    if (!(err instanceof GoogleAuthError) || code === 'failed') {
      this.logger.warn(
        `Google sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    res.redirect(302, `${this.appUrl}/auth/login?error=${code}`);
  }

  private meta(req: Request): SessionMeta {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private setCookie(res: Response, token: string, expires: Date) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.COOKIE_SECURE,
      path: '/api/auth',
      expires,
    });
  }
}
