/**
 * Imitation styles (docs/64-business-styles.md): the admin gives a business a few pages of OTHER
 * brands (Instagram accounts, sites), AI reads them and writes a style guide adapted to this
 * business, and a project picks one style for its drafts. Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import { BUSINESS_REFERENCE_MAX_CHARS } from './business';
import { InstagramManualSchema, type ReferenceAnalysis } from './social';

export const BUSINESS_STYLE_LIMIT = 8;
export const STYLE_SOURCE_LIMIT = 6;
export const STYLE_GUIDE_MAX_CHARS = 3_000;
export const STYLE_MAX_TRAITS = 14;
export const STYLE_MAX_CAVEATS = 6;
/** All sources together, as given to the model; each source gets an equal share. */
export const STYLE_SOURCES_PROMPT_CHARS = 60_000;

export const StyleSourceKind = ['INSTAGRAM', 'WEBSITE', 'URL', 'TEXT'] as const;
export type StyleSourceKind = (typeof StyleSourceKind)[number];

export const StyleTraitCategory = [
  'TONE',
  'STRUCTURE',
  'HOOK',
  'VOCABULARY',
  'RHYTHM',
  'FORMATTING',
  'EMOJI',
  'CTA',
  'HASHTAGS',
  'AVOID',
] as const;
export type StyleTraitCategory = (typeof StyleTraitCategory)[number];

export const StyleTraitSchema = z.object({
  category: z.enum(StyleTraitCategory),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
});
export type StyleTrait = z.infer<typeof StyleTraitSchema>;

/** What BUSINESS_STYLE_BUILD returns (the runner validates it before saving). */
export const StyleBuildSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  traits: z.array(StyleTraitSchema).min(1).max(STYLE_MAX_TRAITS),
  guide: z.string().trim().min(1).max(STYLE_GUIDE_MAX_CHARS),
  caveats: z.array(z.string().trim().min(1).max(400)).max(STYLE_MAX_CAVEATS).default([]),
});
export type StyleBuild = z.infer<typeof StyleBuildSchema>;

const styleName = z.string().trim().min(1).max(80);
const direction = z.string().trim().max(1000);

export const CreateBusinessStyleSchema = z.object({
  name: styleName,
  direction: direction.optional().default(''),
});
export type CreateBusinessStyleInput = z.input<typeof CreateBusinessStyleSchema>;

/** Editing `summary` or `guide` counts as the admin's confirmation of the style. */
export const UpdateBusinessStyleSchema = z.object({
  name: styleName.optional(),
  direction: direction.optional(),
  summary: z.string().trim().min(1).max(1200).optional(),
  guide: z.string().trim().min(1).max(STYLE_GUIDE_MAX_CHARS).optional(),
});
export type UpdateBusinessStyleInput = z.infer<typeof UpdateBusinessStyleSchema>;

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links');

/**
 * Adds a source: an Instagram account or a single page (`url`), a whole site (`url` + `site`), a
 * pasted text, or Instagram data given by hand.
 */
export const AddStyleSourceSchema = z
  .object({
    url: httpUrl.optional(),
    title: z.string().trim().max(300).optional().default(''),
    content: z.string().trim().max(BUSINESS_REFERENCE_MAX_CHARS).optional(),
    site: z.boolean().optional().default(false),
    instagram: InstagramManualSchema.optional(),
  })
  .refine((v) => [!!v.url, !!v.content, !!v.instagram].filter(Boolean).length === 1, {
    message: 'Give either a link, a text or Instagram data',
  })
  .refine((v) => !v.site || !!v.url, 'A website needs its link');
export type AddStyleSourceInput = z.input<typeof AddStyleSourceSchema>;

export type StyleBuildState = 'NONE' | 'BUILDING' | 'READY' | 'FAILED';

export interface StyleSourceSummary {
  id: string;
  kind: StyleSourceKind;
  url: string;
  title: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  error: string | null;
  fetchedAt: string | null;
  /** Length of the text snapshot (the text itself comes with the detail). */
  chars: number;
  analysis?: ReferenceAnalysis | null;
}

export interface BusinessStyleSummary {
  id: string;
  businessId: string;
  name: string;
  direction: string;
  buildState: StyleBuildState;
  buildError: string | null;
  /** The BUSINESS_STYLE_BUILD job of the last build, for tracking it. */
  lastJobId: string | null;
  summary: string;
  builtAt: string | null;
  reviewedAt: string | null;
  sourceCount: number;
  topicCount: number;
  updatedAt: string;
}

export interface BusinessStyleDetail extends BusinessStyleSummary {
  traits: StyleTrait[];
  guide: string;
  caveats: string[];
  sources: StyleSourceSummary[];
}

/** A style that can be chosen in a project: built and confirmed. */
export const isStyleUsable = (s: { buildState: string; reviewedAt: string | Date | null }) =>
  s.buildState === 'READY' && !!s.reviewedAt;
