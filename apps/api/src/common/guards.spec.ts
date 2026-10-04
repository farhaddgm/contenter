import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { Role } from '@contenter/shared';
import { RolesGuard } from './guards';

function ctx(method: string, role: Role | null): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ method, user: role ? { id: 'u', email: 'e', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function guard(required?: Role[], topicScoped = false) {
  const reflector = {
    getAllAndOverride: () => required,
    get: () => (topicScoped ? { via: 'topic', param: 'id' } : undefined),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('lets ADMIN through everything', () => {
    expect(guard(['EDITOR']).canActivate(ctx('DELETE', 'ADMIN'))).toBe(true);
  });
  it('makes VIEWER read-only', () => {
    expect(guard().canActivate(ctx('GET', 'VIEWER'))).toBe(true);
    expect(() => guard().canActivate(ctx('POST', 'VIEWER'))).toThrow(ForbiddenException);
  });
  it('leaves project routes to the per-project grant', () => {
    expect(guard(undefined, true).canActivate(ctx('POST', 'VIEWER'))).toBe(true);
    expect(() => guard(['ADMIN'], true).canActivate(ctx('POST', 'VIEWER'))).toThrow(
      ForbiddenException,
    );
  });
  it('lets EDITOR mutate by default', () => {
    expect(guard().canActivate(ctx('POST', 'EDITOR'))).toBe(true);
  });
  it('enforces @Roles', () => {
    expect(() => guard(['ADMIN']).canActivate(ctx('GET', 'EDITOR'))).toThrow(ForbiddenException);
  });
  it('allows public (unauthenticated) routes', () => {
    expect(guard().canActivate(ctx('POST', null))).toBe(true);
  });
});
