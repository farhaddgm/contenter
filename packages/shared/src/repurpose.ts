/** Repurposing: the same content written again for another platform (docs/23-repurposing.md). */
import type { ContentFormat, Platform } from './enums';

/** The format a platform usually wants; the admin can pick another one per target. */
export const PLATFORM_DEFAULT_FORMAT: Record<Platform, ContentFormat> = {
  INSTAGRAM: 'CAROUSEL',
  YOUTUBE: 'SHORT_VIDEO_SCRIPT',
  TELEGRAM: 'POST',
  LINKEDIN: 'ARTICLE',
  X: 'THREAD',
  TIKTOK: 'SHORT_VIDEO_SCRIPT',
  BLOG: 'ARTICLE',
  OTHER: 'POST',
};

export const defaultFormatFor = (platform: Platform): ContentFormat =>
  PLATFORM_DEFAULT_FORMAT[platform];

/** A content's platform: its own when it was made for one, else its topic's. */
export const effectivePlatform = (
  content: { platform?: Platform | null },
  topic: { platform: Platform },
): Platform => content.platform ?? topic.platform;

/** At most this many versions are written in one request. */
export const MAX_REPURPOSE_TARGETS = 6;
