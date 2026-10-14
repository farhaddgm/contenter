/**
 * Personal API keys and the public `/api/v1` (docs/52-api-keys.md). A key carries its owner's
 * identity — never more access than the person has — narrowed by scopes. Only a few read routes
 * and the "ask for a draft" route accept a key; review, approval, scheduling and publishing are
 * not reachable with one, so the final approval stays human.
 */
import { z } from 'zod';
import type { ContentFormat, ContentStatus, Platform, Role } from './enums';

export const API_KEY_PREFIX = 'ctk_';
export const API_KEY_MAX_ACTIVE = 5;
export const API_KEY_DEFAULT_DAYS = 90;
export const API_KEY_MAX_DAYS = 365;
/** An active key not used for this long gets a warning. */
export const API_KEY_UNUSED_WARN_DAYS = 30;

export const ApiKeyScope = ['contents:read', 'contents:write', 'calendar:read'] as const;
export type ApiKeyScope = (typeof ApiKeyScope)[number];

/** A read-only account (VIEWER) can only hold read scopes. */
export function scopesAllowedFor(role: Role): ApiKeyScope[] {
  return role === 'VIEWER' ? ApiKeyScope.filter((s) => s.endsWith(':read')) : [...ApiKeyScope];
}

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.enum(ApiKeyScope))
    .min(1)
    .max(ApiKeyScope.length)
    .refine((s) => new Set(s).size === s.length, 'A scope is listed twice'),
  expiresInDays: z.number().int().min(1).max(API_KEY_MAX_DAYS).default(API_KEY_DEFAULT_DAYS),
});
export type CreateApiKeyInput = z.input<typeof CreateApiKeySchema>;

export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ApiKeyInfo {
  id: string;
  name: string;
  /** Shown so the person can tell keys apart; the rest of the key is never stored in clear. */
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The only response that carries the whole key; it cannot be shown again. */
export interface CreatedApiKey extends ApiKeyInfo {
  key: string;
}

const DAY = 86_400_000;

export function apiKeyStatus(
  k: Pick<ApiKeyInfo, 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): ApiKeyStatus {
  if (k.revokedAt) return 'REVOKED';
  return new Date(k.expiresAt) <= now ? 'EXPIRED' : 'ACTIVE';
}

/** An active key nobody used for `API_KEY_UNUSED_WARN_DAYS` days (counted from creation if never). */
export function isApiKeyUnused(
  k: Pick<ApiKeyInfo, 'expiresAt' | 'revokedAt' | 'lastUsedAt' | 'createdAt'>,
  now: Date = new Date(),
): boolean {
  if (apiKeyStatus(k, now) !== 'ACTIVE') return false;
  const since = new Date(k.lastUsedAt ?? k.createdAt).getTime();
  return now.getTime() - since >= API_KEY_UNUSED_WARN_DAYS * DAY;
}

/** A bearer token is an API key (not a JWT) when it carries the key prefix. */
export const looksLikeApiKey = (token: string): boolean => token.startsWith(API_KEY_PREFIX);

// ---------- /api/v1 documents (stable: add fields, never rename or remove) ----------

export interface ApiV1Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiV1Topic {
  id: string;
  title: string;
  platform: Platform;
  language: string;
  status: string;
  businessId: string | null;
}

export interface ApiV1Content {
  id: string;
  topicId: string;
  title: string;
  status: ContentStatus;
  format: ContentFormat;
  /** The platform it is for: its own, else its topic's. */
  platform: Platform;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiV1ContentDetail extends ApiV1Content {
  /** The current draft; null until one exists. */
  text: { title: string; body: string; hashtags: string[]; cta: string } | null;
}

export interface ApiV1CalendarItem {
  id: string;
  topicId: string;
  title: string;
  status: ContentStatus;
  format: ContentFormat;
  platform: Platform;
  scheduledAt: string | null;
  publishedAt: string | null;
}

export interface ApiV1GenerateResult {
  contentId: string;
  jobId: string;
}
