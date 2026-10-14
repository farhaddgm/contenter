import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ApiKeyScope, Role } from '@contenter/shared';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export const IS_PUBLIC_KEY = 'isPublic';
/** Skip JWT authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restrict an endpoint to the given roles. ADMIN always passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});

export const API_KEY_SCOPE_KEY = 'apiKeyScope';
/**
 * Let a personal API key (docs/52-api-keys.md) with this scope call the route. Without it a key is
 * refused with 403, so a new route is never reachable with a key by accident.
 */
export const AllowApiKey = (scope: ApiKeyScope) => SetMetadata(API_KEY_SCOPE_KEY, scope);

/** Who an API key speaks for. Set on the request by the guard, for the audit trail and tests. */
export interface ApiKeyAuth {
  user: AuthUser;
  keyId: string;
  scopes: ApiKeyScope[];
}

/** Injection token of the API-key authenticator (provided by `ApiKeysModule`). */
export const API_KEY_AUTH = Symbol('API_KEY_AUTH');
export interface ApiKeyAuthenticator {
  /** Throws 401 for anything that is not a live key of an active user, 429 over the rate limit. */
  authenticate(rawKey: string): Promise<ApiKeyAuth>;
}
