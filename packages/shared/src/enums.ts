/**
 * Domain enums shared between API, worker and web.
 * Keep in sync with `apps/api/prisma/schema.prisma`.
 */

export const Role = ['ADMIN', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof Role)[number];

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
] as const;
export type AiJobType = (typeof AiJobType)[number];

export const AiJobStatus = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export type AiJobStatus = (typeof AiJobStatus)[number];

export const AiEffort = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AiEffort)[number];
