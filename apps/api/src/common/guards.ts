import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { normalizeGmail, type Role } from '@contenter/shared';
import { ENV, type Env } from '../config/env';
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthUser } from './auth.decorators';
import { ACCESS_SCOPE_KEY } from './access';

interface AccessPayload {
  sub: string;
  email: string;
  role: Role;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      req.user = { id: payload.sub, email: payload.email, role: payload.role } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

/**
 * Default policy: VIEWER is read-only (GET). Mutations need EDITOR or ADMIN.
 * `@Roles(...)` narrows further; ADMIN always passes.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) return true; // public route
    if (user.role === 'ADMIN') return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length) {
      if (!required.includes(user.role)) throw new ForbiddenException('Insufficient role');
      return true;
    }

    // project routes: the per-project grant decides (AccessGuard), not the global role
    if (this.reflector.get(ACCESS_SCOPE_KEY, ctx.getHandler())) return true;

    if (req.method !== 'GET' && user.role === 'VIEWER') {
      throw new ForbiddenException('Read-only account');
    }
    return true;
  }
}

/** Only the application owner (OWNER_EMAIL) passes — use with `@UseGuards(OwnerGuard)`. */
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || normalizeGmail(user.email) !== normalizeGmail(this.env.OWNER_EMAIL)) {
      throw new ForbiddenException('Only the owner can do this');
    }
    return true;
  }
}
