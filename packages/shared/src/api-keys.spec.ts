import { describe, expect, it } from 'vitest';
import {
  API_KEY_DEFAULT_DAYS,
  API_KEY_MAX_ACTIVE,
  ApiKeyScope,
  CreateApiKeySchema,
  apiKeyStatus,
  isApiKeyUnused,
  looksLikeApiKey,
  scopesAllowedFor,
} from './api-keys';

const now = new Date('2026-10-14T12:00:00Z');
const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

describe('scopes', () => {
  it('a read-only account can only hold read scopes', () => {
    expect(scopesAllowedFor('VIEWER')).toEqual(['contents:read', 'calendar:read']);
    expect(scopesAllowedFor('EDITOR')).toEqual([...ApiKeyScope]);
    expect(scopesAllowedFor('ADMIN')).toEqual([...ApiKeyScope]);
  });

  it('there is no scope for review, approval or publishing', () => {
    expect(ApiKeyScope.some((s) => /review|approve|publish|schedule/.test(s))).toBe(false);
  });
});

describe('CreateApiKeySchema', () => {
  it('defaults the expiry to 90 days and trims the name', () => {
    const k = CreateApiKeySchema.parse({ name: '  n8n ', scopes: ['contents:read'] });
    expect(k).toEqual({
      name: 'n8n',
      scopes: ['contents:read'],
      expiresInDays: API_KEY_DEFAULT_DAYS,
    });
  });

  it('refuses no scope, an unknown scope, a repeated scope, a long name and a too-long expiry', () => {
    const base = { name: 'k', scopes: ['contents:read'] };
    expect(CreateApiKeySchema.safeParse({ ...base, scopes: [] }).success).toBe(false);
    expect(CreateApiKeySchema.safeParse({ ...base, scopes: ['reviews:write'] }).success).toBe(
      false,
    );
    expect(
      CreateApiKeySchema.safeParse({ ...base, scopes: ['contents:read', 'contents:read'] }).success,
    ).toBe(false);
    expect(CreateApiKeySchema.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false);
    expect(CreateApiKeySchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(CreateApiKeySchema.safeParse({ ...base, expiresInDays: 366 }).success).toBe(false);
    expect(CreateApiKeySchema.safeParse({ ...base, expiresInDays: 0 }).success).toBe(false);
  });

  it('keeps at most five active keys per person', () => {
    expect(API_KEY_MAX_ACTIVE).toBe(5);
  });
});

describe('key status', () => {
  const k = (over = {}) => ({
    createdAt: day(-100),
    expiresAt: day(10),
    lastUsedAt: day(-1) as string | null,
    revokedAt: null as string | null,
    ...over,
  });

  it('is active, expired or revoked (revoked wins)', () => {
    expect(apiKeyStatus(k(), now)).toBe('ACTIVE');
    expect(apiKeyStatus(k({ expiresAt: day(-1) }), now)).toBe('EXPIRED');
    expect(apiKeyStatus(k({ expiresAt: day(-1), revokedAt: day(-2) }), now)).toBe('REVOKED');
    expect(apiKeyStatus(k({ expiresAt: now.toISOString() }), now)).toBe('EXPIRED');
  });

  it('warns about an active key unused for 30 days, counted from creation if never used', () => {
    expect(isApiKeyUnused(k(), now)).toBe(false);
    expect(isApiKeyUnused(k({ lastUsedAt: day(-31) }), now)).toBe(true);
    expect(isApiKeyUnused(k({ lastUsedAt: null, createdAt: day(-40) }), now)).toBe(true);
    expect(isApiKeyUnused(k({ lastUsedAt: null, createdAt: day(-5) }), now)).toBe(false);
    // a key that is already dead is not "unused"
    expect(isApiKeyUnused(k({ lastUsedAt: day(-90), revokedAt: day(-1) }), now)).toBe(false);
  });
});

describe('looksLikeApiKey', () => {
  it('tells a key from a JWT', () => {
    expect(looksLikeApiKey('ctk_ab12cd34_secret')).toBe(true);
    expect(looksLikeApiKey('eyJhbGciOiJIUzI1NiJ9.e30.x')).toBe(false);
    expect(looksLikeApiKey('')).toBe(false);
  });
});
