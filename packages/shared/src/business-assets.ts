/**
 * Business admin notes (AI revises the whole profile from a note) and brand assets (past
 * articles, images, banners, artworks, creatives, videos and motion the AI learns from).
 * See docs/15-business-notes-and-assets.md. Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import { BusinessSectionKey, ResearchScope } from './business';
import type { AnalysisStatus } from './enums';

// ---------- admin notes → BUSINESS_REVISE ----------

export const NoteStatus = ['PENDING', 'APPLIED', 'FAILED'] as const;
export type NoteStatus = (typeof NoteStatus)[number];

/** DIRECT = write the sections (old text kept as a revision) · SUGGEST = pending suggestions. */
export const NoteApplyMode = ['DIRECT', 'SUGGEST'] as const;
export type NoteApplyMode = (typeof NoteApplyMode)[number];

export const BUSINESS_NOTE_MAX_CHARS = 6000;

export const CreateBusinessNoteSchema = z.object({
  text: z.string().trim().min(3).max(BUSINESS_NOTE_MAX_CHARS),
  apply: z.enum(NoteApplyMode).default('DIRECT'),
  /** What AI may consult besides the profile and the note. */
  scope: z.enum(ResearchScope).default('NONE'),
  referenceIds: z.array(z.string().min(1).max(50)).max(50).optional(),
  /** Keep giving the note to later builds/suggestions (false for one-off fixes, e.g. audit issues). */
  standing: z.boolean().default(true),
});
export type CreateBusinessNoteInput = z.input<typeof CreateBusinessNoteSchema>;

export const UpdateBusinessNoteSchema = z.object({
  /** Inactive notes are no longer given to later builds/suggestions as standing corrections. */
  isActive: z.boolean(),
});
export type UpdateBusinessNoteInput = z.infer<typeof UpdateBusinessNoteSchema>;

/** Output of BUSINESS_REVISE: only what has to change because of the admin's note. */
export const BusinessReviseResultSchema = z.object({
  summary: z.string().describe('2–4 sentences: what was changed and why, for the admin'),
  tagline: z.string().describe('New tagline, or "" to keep the current one'),
  industry: z.string().describe('New industry, or "" to keep the current one'),
  website: z.string().describe('New official website URL, or "" to keep the current one'),
  location: z.string().describe('New location, or "" to keep the current one'),
  sections: z.array(
    z.object({
      key: z.enum(BusinessSectionKey),
      content: z.string().describe('The full new content of the section in Markdown'),
      change: z.string().describe('One sentence: what changed in this section'),
    }),
  ),
  gaps: z
    .array(z.string())
    .describe('The full, updated list of unverified facts / parts the admin should complete'),
});
export type BusinessReviseResult = z.infer<typeof BusinessReviseResultSchema>;

export interface BusinessNote {
  id: string;
  businessId: string;
  text: string;
  apply: NoteApplyMode;
  scope: ResearchScope;
  status: NoteStatus;
  /** AI's summary of what it changed. */
  summary: string;
  changedKeys: BusinessSectionKey[];
  error: string | null;
  isActive: boolean;
  jobId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

// ---------- brand assets ----------

export const BusinessAssetKind = [
  'ARTICLE',
  'IMAGE',
  'BANNER',
  'ARTWORK',
  'CREATIVE',
  'VIDEO',
  'MOTION',
] as const;
export type BusinessAssetKind = (typeof BusinessAssetKind)[number];

/** Kinds whose main payload is moving picture (frames are captured in the browser). */
export const VIDEO_ASSET_KINDS: readonly BusinessAssetKind[] = ['VIDEO', 'MOTION'];

export const BUSINESS_ASSET_TEXT_MAX_CHARS = 60_000;
export const BUSINESS_ASSET_LIMIT = 200;
export const ASSET_MAX_PREVIEWS = 4;
/** Upload whitelist (extension → kind of file). SVG/HTML are refused: they can run scripts. */
export const ASSET_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;
export const ASSET_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'] as const;

export function assetFileType(fileName: string): 'image' | 'video' | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if ((ASSET_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  if ((ASSET_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  return null;
}

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => u === '' || /^https?:\/\/\S+$/i.test(u), 'Only http(s) links')
  .optional()
  .default('');

/** Text fields of an asset (the file and its previews travel as multipart parts). */
export const CreateBusinessAssetSchema = z.object({
  kind: z.enum(BusinessAssetKind),
  title: z.string().trim().max(300).optional().default(''),
  /** The admin's note: what it is, where it ran, why it worked. */
  description: z.string().trim().max(4000).optional().default(''),
  url: optionalUrl,
  /** Article body, caption, voice-over or transcript. */
  text: z.string().trim().max(BUSINESS_ASSET_TEXT_MAX_CHARS).optional().default(''),
});
export type CreateBusinessAssetInput = z.input<typeof CreateBusinessAssetSchema>;

export const UpdateBusinessAssetSchema = z.object({
  kind: z.enum(BusinessAssetKind).optional(),
  title: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
  text: z.string().trim().max(BUSINESS_ASSET_TEXT_MAX_CHARS).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateBusinessAssetInput = z.infer<typeof UpdateBusinessAssetSchema>;

/** Output of BUSINESS_ASSET_ANALYZE: what a content team must know to match this piece. */
export const BusinessAssetAnalysisSchema = z.object({
  summary: z.string().describe('What the piece is and what it communicates (2–3 sentences)'),
  visualStyle: z
    .string()
    .describe(
      'Colors, typography, layout, imagery, logo use, motion/pacing — or "n/a" for text-only pieces',
    ),
  tone: z.string().describe('Tone of voice and register of the copy'),
  structure: z.string().describe('How the piece is organized: hook, body, close, length'),
  messages: z.array(z.string()).describe('Key messages, slogans, offers and calls to action'),
  copy: z.string().describe('Notable exact wording visible/heard in the piece, or ""'),
  guidelines: z
    .array(z.string())
    .describe('Concrete do/don’t rules a creator should follow to produce matching content'),
  bestFor: z.string().describe('Platforms/formats/campaign goals this style suits'),
});
export type BusinessAssetAnalysis = z.infer<typeof BusinessAssetAnalysisSchema>;

export interface BusinessAsset {
  id: string;
  businessId: string;
  kind: BusinessAssetKind;
  title: string;
  description: string;
  url: string;
  /** Length of the stored text; the text itself comes with the single-asset endpoint. */
  textChars: number;
  text?: string;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  /** Short-lived signed URLs (usable in <img>/<video> without the access token). */
  fileUrl: string | null;
  previewUrls: string[];
  analysisStatus: AnalysisStatus;
  analysis: BusinessAssetAnalysis | null;
  analysisError: string | null;
  lastJobId: string | null;
  isActive: boolean;
  createdAt: string;
}

// ---------- shared (multi-tenant) hosts ----------

/**
 * Hosts where one domain serves everybody's content (file sharing, social networks, blogging
 * platforms, app stores). A link there identifies a page, never "the site of this business", so
 * such hosts are never used to widen a "search only within my references' sites" research.
 */
const SHARED_HOSTS = [
  'google.com',
  'googleusercontent.com',
  'youtube.com',
  'youtu.be',
  'dropbox.com',
  'onedrive.live.com',
  '1drv.ms',
  'sharepoint.com',
  'box.com',
  'icloud.com',
  'notion.so',
  'notion.site',
  'github.com',
  'github.io',
  'gitlab.com',
  'medium.com',
  'substack.com',
  'wordpress.com',
  'blogspot.com',
  'blog.ir',
  'blogfa.com',
  'virgool.io',
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  't.me',
  'telegram.me',
  'tiktok.com',
  'pinterest.com',
  'aparat.com',
  'wikipedia.org',
  'archive.org',
  'scribd.com',
  'slideshare.net',
  'issuu.com',
  'cafebazaar.ir',
  'myket.ir',
  'apple.com',
  'amazon.com',
  'digikala.com',
  'torob.com',
  'divar.ir',
] as const;

export function isSharedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return SHARED_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}
