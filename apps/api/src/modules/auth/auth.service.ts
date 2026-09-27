import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { User } from '@prisma/client';
import { isGmail, normalizeGmail } from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GoogleAuthError, type GoogleIdentity } from './google-oauth.service';

export const isOwnerEmail = (email: string, ownerEmail: string) =>
  normalizeGmail(email) === normalizeGmail(ownerEmail);

export function publicUser(u: User, ownerEmail: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, googleSub, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash, isOwner: isOwnerEmail(u.email, ownerEmail) };
}

/** Password sign-in is allowed only for accounts that have a password and are not Google-only. */
const allowsPassword = (u: User) => !!u.passwordHash && u.loginMethod !== 'GOOGLE';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  isOwner(email: string) {
    return isOwnerEmail(email, this.env.OWNER_EMAIL);
  }

  toPublic(u: User) {
    return publicUser(u, this.env.OWNER_EMAIL);
  }

  hashPassword(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async login(email: string, password: string, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok =
      user &&
      user.isActive &&
      allowsPassword(user) &&
      (await argon2.verify(user.passwordHash!, password));
    if (!ok || !user) {
      this.audit.log({
        action: 'auth.login_failed',
        entityType: 'User',
        meta: { email },
        ip: meta.ip,
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    this.audit.log({
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      meta: { method: 'password' },
      ip: meta.ip,
    });
    return this.issueTokens(updated, meta);
  }

  /**
   * Signs in a verified Google identity. Only the owner (OWNER_EMAIL, auto-provisioned as ADMIN
   * on first sign-in) and Gmail accounts the owner granted (loginMethod GOOGLE/BOTH) get in;
   * the Google account id is bound on first use so a recycled address cannot take over.
   */
  async loginWithGoogle(identity: GoogleIdentity, meta: SessionMeta) {
    const fail = (code: 'not_gmail' | 'not_allowed' | 'inactive', userId?: string) => {
      this.audit.log({
        userId: userId ?? null,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: userId ?? null,
        meta: { method: 'google', email: identity.email, reason: code },
        ip: meta.ip,
      });
      return new GoogleAuthError(code);
    };
    if (!identity.emailVerified || !isGmail(identity.email)) throw fail('not_gmail');

    const owner = this.isOwner(identity.email);
    let user =
      (await this.prisma.user.findUnique({ where: { googleSub: identity.sub } })) ??
      (await this.findGmailUser(identity.email));
    if (user?.googleSub && user.googleSub !== identity.sub) throw fail('not_allowed', user.id);

    if (!user && owner) {
      user = await this.prisma.user.create({
        data: {
          email: this.env.OWNER_EMAIL,
          name: identity.name?.trim() || 'Owner',
          role: 'ADMIN',
          loginMethod: 'GOOGLE',
        },
      });
      this.audit.log({
        userId: user.id,
        action: 'user.create',
        entityType: 'User',
        entityId: user.id,
        meta: { owner: true, via: 'google' },
      });
    }
    if (!user || (!owner && user.loginMethod === 'PASSWORD')) throw fail('not_allowed', user?.id);
    if (!user.isActive && !owner) throw fail('inactive', user.id);

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        googleSub: identity.sub,
        ...(owner ? { role: 'ADMIN', isActive: true } : {}),
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      meta: { method: 'google' },
      ip: meta.ip,
    });
    return this.issueTokens(updated, meta);
  }

  /** Finds the user for a Gmail address, ignoring dots/+tags (exact match wins). */
  async findGmailUser(email: string): Promise<User | null> {
    const exact = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exact) return exact;
    const target = normalizeGmail(email);
    const candidates = await this.prisma.user.findMany({
      where: {
        OR: [{ email: { endsWith: '@gmail.com' } }, { email: { endsWith: '@googlemail.com' } }],
      },
    });
    const matches = candidates.filter((u) => normalizeGmail(u.email) === target);
    return matches.find((u) => u.loginMethod !== 'PASSWORD') ?? matches[0] ?? null;
  }

  /** Rotates the refresh token: the presented one is revoked and a new pair is issued. */
  async refresh(refreshToken: string | undefined, meta: SessionMeta) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date() || !record.user.isActive) {
      if (record && record.revokedAt) {
        // Reuse of a revoked token → possible theft: revoke the whole family for this user.
        await this.prisma.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(record.user, meta);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || user.loginMethod === 'GOOGLE') {
      throw new BadRequestException('This account signs in with Google and has no password');
    }
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword) },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.audit.log({
      userId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: userId,
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.toPublic(user);
  }

  private async issueTokens(user: User, meta: SessionMeta) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
      },
    });
    return { accessToken, refreshToken, refreshExpiresAt: expiresAt, user: this.toPublic(user) };
  }
}
