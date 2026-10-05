import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../../config/env';

/** Constant-time comparison (hashes first so the lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Guards the service API of other applications. Without `INTEGRATION_TOKEN` the routes do not
 * exist (404); with it, every request must carry it as a bearer token. The token reads every
 * business, so it is a secret of the same weight as a password (docs/18-docoo-integration.md).
 */
@Injectable()
export class IntegrationTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.env.INTEGRATION_TOKEN;
    if (!expected) throw new NotFoundException();
    const header: string | undefined = ctx.switchToHttp().getRequest().headers.authorization;
    const given = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!given || !safeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid integration token');
    }
    return true;
  }
}
