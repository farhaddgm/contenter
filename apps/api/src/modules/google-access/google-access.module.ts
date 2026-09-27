import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  CreateGoogleAccessSchema,
  UpdateGoogleAccessSchema,
  type CreateGoogleAccessInput,
  type UpdateGoogleAccessInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { OwnerGuard } from '../../common/guards';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

/**
 * Owner-only allowlist for "Sign in with Google": a Gmail account can sign in with Google only
 * when it is listed here (loginMethod GOOGLE or BOTH). See docs/11-google-login.md.
 */
@Injectable()
export class GoogleAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      where: { loginMethod: { in: ['GOOGLE', 'BOTH'] } },
      orderBy: { createdAt: 'desc' },
    });
    return users.filter((u) => !this.auth.isOwner(u.email)).map((u) => this.auth.toPublic(u));
  }

  /** Grants Google sign-in; an existing account with the same Gmail is converted, not duplicated. */
  async grant(input: CreateGoogleAccessInput, actor: AuthUser) {
    if (this.auth.isOwner(input.email)) {
      throw new BadRequestException('The owner always has Google access');
    }
    const existing = await this.auth.findGmailUser(input.email);
    const passwordHash = await this.passwordFor(input.loginMethod, input.password, existing);
    const data = {
      name: input.name,
      role: input.role,
      loginMethod: input.loginMethod,
      isActive: true,
      passwordHash,
    };
    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data })
      : await this.prisma.user.create({ data: { ...data, email: input.email } });
    if (existing && input.loginMethod === 'GOOGLE') await this.revokeSessions(user.id);
    this.audit.log({
      userId: actor.id,
      action: 'google_access.grant',
      entityType: 'User',
      entityId: user.id,
      meta: { email: user.email, role: user.role, loginMethod: user.loginMethod },
    });
    return this.auth.toPublic(user);
  }

  async update(id: string, input: UpdateGoogleAccessInput, actor: AuthUser) {
    const target = await this.target(id);
    const loginMethod = input.loginMethod ?? target.loginMethod;
    const passwordHash =
      input.password || loginMethod !== target.loginMethod
        ? await this.passwordFor(loginMethod, input.password, target)
        : target.passwordHash;
    const { password, ...rest } = input;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, passwordHash },
    });
    if (input.isActive === false || password || passwordHash !== target.passwordHash) {
      await this.revokeSessions(id);
    }
    this.audit.log({
      userId: actor.id,
      action: 'google_access.update',
      entityType: 'User',
      entityId: id,
      meta: { ...rest, passwordReset: !!password },
    });
    return this.auth.toPublic(user);
  }

  /**
   * Removes Google sign-in. An account with a password falls back to password-only;
   * a Google-only account has no other way in, so it is deactivated.
   */
  async revoke(id: string, actor: AuthUser) {
    const target = await this.target(id);
    await this.prisma.user.update({
      where: { id },
      data: {
        loginMethod: 'PASSWORD',
        googleSub: null,
        isActive: target.passwordHash ? target.isActive : false,
      },
    });
    await this.revokeSessions(id);
    this.audit.log({
      userId: actor.id,
      action: 'google_access.revoke',
      entityType: 'User',
      entityId: id,
      meta: { email: target.email, deactivated: !target.passwordHash },
    });
  }

  private async target(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.loginMethod === 'PASSWORD') throw new NotFoundException('Not found');
    if (this.auth.isOwner(user.email)) {
      throw new ForbiddenException('The owner account cannot be changed here');
    }
    return user;
  }

  /** GOOGLE → no password. BOTH → the new password, else the existing one (required). */
  private async passwordFor(
    method: CreateGoogleAccessInput['loginMethod'] | User['loginMethod'],
    password: string | undefined,
    existing: User | null,
  ): Promise<string | null> {
    if (method === 'GOOGLE') {
      if (password) throw new BadRequestException('Google-only accounts have no password');
      return null;
    }
    if (password) return this.auth.hashPassword(password);
    if (existing?.passwordHash) return existing.passwordHash;
    throw new BadRequestException('A password is required for password sign-in');
  }

  private revokeSessions(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

@Controller('owner/google-access')
@Roles('ADMIN')
@UseGuards(OwnerGuard)
export class GoogleAccessController {
  constructor(private readonly access: GoogleAccessService) {}

  @Get()
  list() {
    return this.access.list();
  }

  @Post()
  grant(
    @Body(new ZodValidationPipe(CreateGoogleAccessSchema)) body: CreateGoogleAccessInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.access.grant(body, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateGoogleAccessSchema)) body: UpdateGoogleAccessInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.access.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.access.revoke(id, actor);
  }
}

@Module({
  controllers: [GoogleAccessController],
  providers: [GoogleAccessService],
})
export class GoogleAccessModule {}
