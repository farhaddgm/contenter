/**
 * Instagram account + website sources of a business (docs/28-instagram-website-profile.md).
 * Pure helpers and contracts shared by the API (reading/analysis) and the web (forms, report).
 */
import { z } from 'zod';

// ---------- Instagram handle / links ----------

const IG_HOSTS = ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'];
/** First path segments of instagram.com that are not an account. */
const IG_RESERVED = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'about',
  'legal',
  'developer',
  'privacy',
  'web',
  'directory',
  'challenge',
  'locations',
  'tags',
  'share',
  'api',
  'oauth',
  'emails',
  'session',
  'static',
  'topics',
  'nametag',
]);
const IG_USERNAME = /^[a-z0-9._]{1,30}$/;

export function isInstagramUrl(input: string): boolean {
  try {
    return IG_HOSTS.includes(new URL(input.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The username of an account from `@name`, `name` or an instagram.com profile link
 * (`/name`, `/name/`, `/name/?hl=fa`). Null for post/reel/story links and anything else that
 * is not an account.
 */
export function parseInstagramHandle(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let name: string;
  if (/^https?:\/\//i.test(raw) || /^(www\.|m\.)?(instagram\.com|instagr\.am)\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    if (!IG_HOSTS.includes(url.hostname.toLowerCase())) return null;
    const [first, second] = url.pathname.split('/').filter(Boolean);
    if (!first) return null;
    // /name/p/… is not a profile link either — but /name/ and /name/reels/ are.
    if (second && !['reels', 'tagged', 'channel', 'guide'].includes(second.toLowerCase())) {
      return null;
    }
    name = first;
  } else {
    name = raw.replace(/^@/, '');
  }
  name = name.toLowerCase();
  if (!IG_USERNAME.test(name) || IG_RESERVED.has(name) || /^\.|\.$|\.\./.test(name)) return null;
  return name;
}

export const instagramProfileUrl = (handle: string) => `https://www.instagram.com/${handle}/`;

// ---------- Instagram data ----------

export const InstagramMediaType = ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL', 'UNKNOWN'] as const;
export type InstagramMediaType = (typeof InstagramMediaType)[number];

/** Where the data of an Instagram source came from. */
export const InstagramProvider = ['GRAPH', 'MANUAL'] as const;
export type InstagramProvider = (typeof InstagramProvider)[number];

export interface InstagramProfile {
  username: string;
  name: string;
  biography: string;
  /** The link in the bio. */
  website: string;
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
}

export interface InstagramPost {
  caption: string;
  /** ISO time, null when unknown. */
  takenAt: string | null;
  mediaType: InstagramMediaType;
  likes: number | null;
  comments: number | null;
  permalink: string;
}

export const INSTAGRAM_MAX_POSTS = 100;
export const INSTAGRAM_CAPTION_MAX = 5000;

const optionalCount = z.number().int().min(0).max(2_000_000_000).nullable().optional();

export const InstagramManualPostSchema = z.object({
  caption: z.string().trim().max(INSTAGRAM_CAPTION_MAX),
  takenAt: z.string().trim().max(40).nullable().optional(),
  mediaType: z.enum(InstagramMediaType).optional(),
  likes: optionalCount,
  comments: optionalCount,
  permalink: z.string().trim().max(500).optional(),
});
export type InstagramManualPost = z.input<typeof InstagramManualPostSchema>;

/** What the admin gives when the account cannot be read through the API (or by choice). */
export const InstagramManualSchema = z
  .object({
    handle: z.string().trim().max(200).optional().default(''),
    name: z.string().trim().max(200).optional().default(''),
    biography: z.string().trim().max(2000).optional().default(''),
    website: z.string().trim().max(500).optional().default(''),
    followers: optionalCount,
    following: optionalCount,
    mediaCount: optionalCount,
    posts: z.array(InstagramManualPostSchema).max(INSTAGRAM_MAX_POSTS).optional().default([]),
  })
  .refine(
    (v) => !v.handle || parseInstagramHandle(v.handle) !== null,
    'Not a valid Instagram username or profile link',
  )
  .refine(
    (v) => v.biography.length > 0 || v.posts.some((p) => p.caption.length > 0),
    'Give the bio or at least one caption',
  );
export type InstagramManualInput = z.input<typeof InstagramManualSchema>;

/** Splits pasted captions: posts are separated by a line made of dashes (`---`). */
export function splitCaptions(raw: string): string[] {
  return raw
    .split(/\r?\n[ \t]*-{3,}[ \t]*\r?\n/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Undoes the classic mis-decoding of Instagram's data export (UTF-8 bytes stored as Latin-1
 * code points, so Persian shows up as `Ø§Ù…`). Text that is already fine is returned as is.
 */
export function fixMojibake(text: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(text)) return text;
  if ([...text].some((c) => c.charCodeAt(0) > 0xff)) return text;
  try {
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return fixed;
  } catch {
    return text;
  }
}

function exportTime(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Reads the posts file of Instagram's official data export ("Download your information",
 * JSON format: `posts_1.json`, `reels.json` …) into posts. Throws an Error with a readable
 * message when the file is not such an export.
 */
export function parseInstagramExport(raw: string): InstagramManualPost[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('The file is not valid JSON. Choose the JSON posts file of the export.');
  }
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? ((Object.values(data).find(Array.isArray) as unknown[] | undefined) ?? [])
      : [];
  const posts: InstagramManualPost[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const post = item as {
      title?: unknown;
      creation_timestamp?: unknown;
      media?: { title?: unknown; uri?: unknown; creation_timestamp?: unknown }[];
    };
    const media = Array.isArray(post.media) ? post.media : [];
    const first = media[0];
    const caption = [post.title, first?.title].find(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    );
    const takenAt = exportTime(post.creation_timestamp ?? first?.creation_timestamp);
    if (!caption && !takenAt) continue;
    const uri = typeof first?.uri === 'string' ? first.uri : '';
    posts.push({
      caption: fixMojibake(caption ?? '').slice(0, INSTAGRAM_CAPTION_MAX),
      takenAt,
      mediaType:
        media.length > 1
          ? 'CAROUSEL'
          : /\.(mp4|mov)$/i.test(uri)
            ? uri.includes('/reels/')
              ? 'REEL'
              : 'VIDEO'
            : 'IMAGE',
    });
  }
  if (!posts.length) {
    throw new Error('No posts were found in this file. Use posts_1.json from the JSON export.');
  }
  posts.sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''));
  return posts.slice(0, INSTAGRAM_MAX_POSTS);
}

// ---------- analysis (computed by code, stored with the reference) ----------

export interface InstagramPostBrief {
  permalink: string;
  takenAt: string | null;
  mediaType: InstagramMediaType;
  likes: number | null;
  comments: number | null;
  /** First line of the caption. */
  hook: string;
}

export interface InstagramStats {
  postsAnalyzed: number;
  firstPostAt: string | null;
  lastPostAt: string | null;
  postsPerWeek: number | null;
  formatMix: Partial<Record<InstagramMediaType, number>>;
  avgCaptionChars: number;
  emptyCaptions: number;
  avgEmojisPerPost: number;
  avgHashtagsPerPost: number;
  topHashtags: { tag: string; count: number }[];
  topMentions: { handle: string; count: number }[];
  /** Share (0..1) of letters written in Persian/Arabic script and in Latin script. */
  scriptShare: { persian: number; latin: number };
  /** Share (0..1) of captions with a call to action / with a question. */
  ctaShare: number;
  questionShare: number;
  /** Null when the source gives no like/comment counts. */
  engagement: {
    postsWithCounts: number;
    avgLikes: number;
    avgComments: number;
    /** (avg likes + avg comments) / followers, in percent; null without a follower count. */
    ratePct: number | null;
  } | null;
  topPosts: InstagramPostBrief[];
}

export interface InstagramAnalysis {
  type: 'INSTAGRAM';
  provider: InstagramProvider;
  profile: InstagramProfile;
  stats: InstagramStats;
}

export interface WebsitePageBrief {
  url: string;
  title: string;
  chars: number;
}

export interface SocialLink {
  network: string;
  url: string;
  /** Instagram links only: the username. */
  handle?: string;
}

export interface WebsiteAnalysis {
  type: 'WEBSITE';
  origin: string;
  /** Business name as the site states it (structured data, og:site_name, title). */
  name: string;
  description: string;
  language: string;
  pages: WebsitePageBrief[];
  /** Pages found worth reading but not read (limit, robots.txt, errors, too little text). */
  skipped: number;
  /** robots.txt disallowed at least one page we wanted. */
  robotsLimited: boolean;
  sitemap: boolean;
  schemaTypes: string[];
  emails: string[];
  phones: string[];
  socialLinks: SocialLink[];
}

export type ReferenceAnalysis = InstagramAnalysis | WebsiteAnalysis;

// ---------- requests ----------

const siteUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links');

/**
 * "Build from an Instagram account and a website": the sources are read by code, then the
 * profile is built from them (BUSINESS_BUILD limited to the admin's sources by default).
 */
export const CreateFromPresenceSchema = z
  .object({
    /** Empty = taken from the sources (account name, site name). */
    name: z.string().trim().max(200).optional().default(''),
    language: z.string().trim().min(2).max(10).default('fa'),
    location: z.string().trim().max(200).optional().default(''),
    /** `@name`, `name` or the profile link. Read through the Instagram API when it is set up. */
    instagram: z.string().trim().max(300).optional().default(''),
    /** Bio/captions given by hand (an alternative to reading the account). */
    instagramManual: InstagramManualSchema.optional(),
    website: siteUrl.optional().or(z.literal('')).default(''),
    // Same values as BuildScope (business.ts imports this file, so it cannot be imported back).
    scope: z.enum(['REFERENCES', 'REFERENCE_SITES', 'WEB']).default('REFERENCES'),
    instruction: z.string().trim().max(2000).optional().default(''),
  })
  .refine((v) => v.instagram === '' || parseInstagramHandle(v.instagram) !== null, {
    message: 'Not a valid Instagram username or profile link',
    path: ['instagram'],
  })
  .refine((v) => !!v.instagram || !!v.instagramManual || !!v.website, {
    message: 'Give an Instagram account, its bio/captions, or a website',
  });
export type CreateFromPresenceInput = z.input<typeof CreateFromPresenceSchema>;

export interface InstagramStatus {
  /** The Instagram API (Business Discovery) is set up on the server. */
  graphConfigured: boolean;
}
