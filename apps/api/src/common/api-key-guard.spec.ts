import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import type { ApiKeyScope } from '@contenter/shared';
import { ReviewsController } from '../modules/reviews/reviews.module';
import { CalendarController } from '../modules/calendar/calendar.module';
import { ContentsController } from '../modules/contents/contents.module';
import { ApiKeysController } from '../modules/api-keys/api-keys.module';
import { ApiV1Controller } from '../modules/api-keys/v1.controller';
import type { Env } from '../config/env';
import { API_KEY_SCOPE_KEY, type ApiKeyAuthenticator } from './auth.decorators';
import { JwtAuthGuard } from './guards';

const KEY = 'ctk_0123abcd_' + 'A'.repeat(43);

function ctx(authorization: string | undefined, scope?: ApiKeyScope) {
  const req: Record<string, unknown> = { headers: { authorization } };
  const context = {
    getHandler: () => ({ scope }),
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function guard(opts: { keys?: ApiKeyAuthenticator; jwtOk?: boolean } = {}) {
  const reflector = {
    getAllAndOverride: (key: string, targets: { scope?: ApiKeyScope }[]) =>
      key === API_KEY_SCOPE_KEY ? targets[0]?.scope : undefined,
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: vi.fn(async () => {
      if (opts.jwtOk === false) throw new Error('bad');
      return { sub: 'u9', email: 'j@x.test', role: 'EDITOR' };
    }),
  } as unknown as JwtService;
  return new JwtAuthGuard(reflector, jwt, { JWT_ACCESS_SECRET: 's' } as Env, opts.keys);
}

const keys = (scopes: ApiKeyScope[]): ApiKeyAuthenticator => ({
  authenticate: vi.fn(async () => ({
    user: { id: 'u1', email: 'e@x.test', role: 'EDITOR' as const },
    keyId: 'k1',
    scopes,
  })),
});

describe('JwtAuthGuard with API keys', () => {
  it('lets a key with the right scope into a route that opted in, as its owner', async () => {
    const { context, req } = ctx(`Bearer ${KEY}`, 'contents:read');
    await expect(guard({ keys: keys(['contents:read']) }).canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'u1', email: 'e@x.test', role: 'EDITOR' });
    expect(req.apiKeyId).toBe('k1');
  });

  it('refuses a key on a route that did not opt in, without even looking the key up', async () => {
    const k = keys(['contents:read', 'contents:write', 'calendar:read']);
    const { context } = ctx(`Bearer ${KEY}`);
    await expect(guard({ keys: k }).canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(k.authenticate).not.toHaveBeenCalled();
  });

  it('refuses a key without the scope the route needs (403)', async () => {
    const { context } = ctx(`Bearer ${KEY}`, 'contents:write');
    await expect(
      guard({ keys: keys(['contents:read']) }).canActivate(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes the 401 of an invalid key through', async () => {
    const bad: ApiKeyAuthenticator = {
      authenticate: async () => {
        throw new UnauthorizedException('Invalid API key');
      },
    };
    await expect(
      guard({ keys: bad }).canActivate(ctx(`Bearer ${KEY}`, 'contents:read').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a normal sign-in token still works everywhere and never touches the key path', async () => {
    const k = keys(['contents:read']);
    const { context, req } = ctx('Bearer eyJhbGciOi.payload.sig');
    await expect(guard({ keys: k }).canActivate(context)).resolves.toBe(true);
    expect((req.user as { id: string }).id).toBe('u9');
    expect(k.authenticate).not.toHaveBeenCalled();
  });
});

describe('which routes accept an API key', () => {
  const scopeOf = (proto: object, name: string) =>
    Reflect.getMetadata(API_KEY_SCOPE_KEY, (proto as Record<string, object>)[name]);
  const methods = (proto: object) =>
    Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');

  it('exactly the v1 routes opt in, each with its scope', () => {
    const got = Object.fromEntries(
      methods(ApiV1Controller.prototype).map((n) => [n, scopeOf(ApiV1Controller.prototype, n)]),
    );
    expect(got).toEqual({
      listTopics: 'contents:read',
      listContents: 'contents:read',
      getContent: 'contents:read',
      generate: 'contents:write',
      calendarItems: 'calendar:read',
    });
  });

  it('review, approval, scheduling, publishing, content editing and key management do not', () => {
    for (const C of [
      ReviewsController,
      CalendarController,
      ContentsController,
      ApiKeysController,
    ]) {
      for (const n of methods(C.prototype)) {
        expect(scopeOf(C.prototype, n), `${C.name}.${n}`).toBeUndefined();
      }
    }
  });
});
