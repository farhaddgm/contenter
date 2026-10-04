/**
 * Domain enums shared between API, worker and web.
 * Keep in sync with `apps/api/prisma/schema.prisma`.
 */

export const Role = ['ADMIN', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof Role)[number];

/**
 * How a user may sign in. PASSWORD = email + password only (default);
 * GOOGLE = "Sign in with Google" only, no password; BOTH = either.
 * Only the owner can grant GOOGLE/BOTH (docs/11-google-login.md).
 */
export const LoginMethod = ['PASSWORD', 'GOOGLE', 'BOTH'] as const;
export type LoginMethod = (typeof LoginMethod)[number];

export const Platform = [
  'INSTAGRAM',
  'YOUTUBE',
  'TELEGRAM',
  'LINKEDIN',
  'X',
  'TIKTOK',
  'BLOG',
  'OTHER',
] as const;
export type Platform = (typeof Platform)[number];

export const TopicStatus = ['ACTIVE', 'ARCHIVED'] as const;
export type TopicStatus = (typeof TopicStatus)[number];

/** Per-topic / per-business access of an EDITOR/VIEWER account; admins always EDIT (docs/17). */
export const AccessLevel = ['VIEW', 'EDIT'] as const;
export type AccessLevel = (typeof AccessLevel)[number];

export const PrincipleKind = ['MUST', 'AVOID', 'PREFER'] as const;
export type PrincipleKind = (typeof PrincipleKind)[number];

export const MediaType = ['ARTICLE', 'VIDEO', 'IMAGE', 'POST', 'AUDIO', 'UNKNOWN'] as const;
export type MediaType = (typeof MediaType)[number];

export const FetchStatus = ['PENDING', 'FETCHED', 'FAILED', 'SKIPPED'] as const;
export type FetchStatus = (typeof FetchStatus)[number];

export const AnalysisStatus = ['NONE', 'QUEUED', 'DONE', 'FAILED'] as const;
export type AnalysisStatus = (typeof AnalysisStatus)[number];

export const ProfileStatus = ['DRAFT', 'APPROVED', 'ARCHIVED'] as const;
export type ProfileStatus = (typeof ProfileStatus)[number];

export const TraitCategory = [
  'TONE',
  'STRUCTURE',
  'HOOK',
  'LANGUAGE',
  'FORMAT',
  'VISUAL',
  'CTA',
  'AUDIENCE',
  'OTHER',
] as const;
export type TraitCategory = (typeof TraitCategory)[number];

export const TraitStatus = ['PROPOSED', 'APPROVED', 'REJECTED'] as const;
export type TraitStatus = (typeof TraitStatus)[number];

export const TraitSource = ['AI', 'ADMIN'] as const;
export type TraitSource = (typeof TraitSource)[number];

export const BrandDocKind = ['BRAND_BOOK', 'WRITING_GUIDE', 'OTHER'] as const;
export type BrandDocKind = (typeof BrandDocKind)[number];

export const IdeaStatus = ['PROPOSED', 'SHORTLISTED', 'REJECTED', 'USED'] as const;
export type IdeaStatus = (typeof IdeaStatus)[number];

export const ContentStatus = [
  'GENERATING',
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'FAILED',
] as const;
export type ContentStatus = (typeof ContentStatus)[number];

export const ContentFormat = [
  'POST',
  'CAROUSEL',
  'SHORT_VIDEO_SCRIPT',
  'LONG_VIDEO_SCRIPT',
  'ARTICLE',
  'THREAD',
  'NEWSLETTER',
  'CAPTION',
] as const;
export type ContentFormat = (typeof ContentFormat)[number];

export const AiJobType = [
  'ANALYZE_SAMPLE',
  'BUILD_PROFILE',
  'IDEATE',
  'GENERATE_CONTENT',
  'REVISE_CONTENT',
  'SMART_CHAT',
  'BUSINESS_DISCOVER',
  'BUSINESS_BUILD',
  'BUSINESS_SUGGEST',
  'BUSINESS_REVISE',
  'BUSINESS_ASSET_ANALYZE',
  'BUSINESS_AUDIT',
] as const;
export type AiJobType = (typeof AiJobType)[number];

export const AiJobStatus = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export type AiJobStatus = (typeof AiJobStatus)[number];

export const AiEffort = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AiEffort)[number];

/** Reason codes the Google sign-in callback appends to `/auth/login?error=`. */
export const GoogleLoginError = [
  'not_configured',
  'cancelled',
  'expired',
  'not_gmail',
  'not_allowed',
  'inactive',
  'failed',
] as const;
export type GoogleLoginError = (typeof GoogleLoginError)[number];
