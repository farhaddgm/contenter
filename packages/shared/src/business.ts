/**
 * Businesses (کسب‌وکارها): the company a project (topic) produces content for. A business owns a
 * set of profile sections (services, target market, personas, brand book, …) that every AI job of
 * a linked topic receives as context. Sections are written by the admin or proposed by AI
 * (suggestions the admin accepts), and a business can be discovered and built from web research.
 * See docs/12-businesses.md. Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import { PaginationQuerySchema } from './schemas';

// ---------- enums ----------

export const BusinessStatus = ['ACTIVE', 'ARCHIVED'] as const;
export type BusinessStatus = (typeof BusinessStatus)[number];

/** MANUAL = created by the admin; RESEARCH = built from a keyword discovery (web research). */
export const BusinessOrigin = ['MANUAL', 'RESEARCH'] as const;
export type BusinessOrigin = (typeof BusinessOrigin)[number];

/** State of the "build the whole profile from web research" job. */
export const BusinessBuildState = ['NONE', 'BUILDING', 'READY', 'FAILED'] as const;
export type BusinessBuildState = (typeof BusinessBuildState)[number];

/** Profile sections, in display order. */
export const BusinessSectionKey = [
  'OVERVIEW',
  'SERVICES',
  'TARGET_MARKET',
  'PERSONAS',
  'VALUE_PROPOSITION',
  'COMPETITORS',
  'BRAND_VOICE',
  'BRAND_BOOK',
  'KEY_MESSAGES',
  'CONTENT_PILLARS',
  'GUIDELINES',
  'CHANNELS',
] as const;
export type BusinessSectionKey = (typeof BusinessSectionKey)[number];

/** What each section must contain — shown to the model and used for UI hints. */
export const BUSINESS_SECTION_SPEC: Record<BusinessSectionKey, string> = {
  OVERVIEW: 'What the business is, its history, size, location and mission, in a few paragraphs.',
  SERVICES:
    'Products and services: a Markdown list with a short description, key features and (if public) price range of each.',
  TARGET_MARKET:
    'Target market: segments, geography, B2B/B2C, market size/trends and buying triggers.',
  PERSONAS:
    '2–4 audience personas. For each: name/label, demographics, goals, pains, objections, where they consume content and what message convinces them.',
  VALUE_PROPOSITION:
    'Core value proposition, differentiators and proof points (numbers, awards, guarantees).',
  COMPETITORS: 'Main competitors/alternatives and how this business is positioned against them.',
  BRAND_VOICE:
    'Brand personality and tone of voice: adjectives, how it addresses the audience (formal/informal), do/don’t examples.',
  BRAND_BOOK:
    'Brand book rules for content: name spelling, terminology and forbidden words, colors, typography, logo/visual rules, hashtag and emoji policy.',
  KEY_MESSAGES: 'Key messages, slogans and taglines the content should repeat or support.',
  CONTENT_PILLARS:
    'Content pillars/themes that serve the business goals, with example angles for each.',
  GUIDELINES:
    'Rules and constraints: legal/compliance limits, claims that must not be made, sensitive topics, required disclaimers.',
  CHANNELS:
    'Official website, social channels, contact points and the preferred calls to action (CTA).',
};

export const SectionSource = ['ADMIN', 'AI'] as const;
export type SectionSource = (typeof SectionSource)[number];

export const SuggestionStatus = ['PENDING', 'ACCEPTED', 'DISMISSED'] as const;
export type SuggestionStatus = (typeof SuggestionStatus)[number];

export const DiscoveryStatus = ['RESEARCHING', 'READY', 'FAILED', 'USED'] as const;
export type DiscoveryStatus = (typeof DiscoveryStatus)[number];

export const BUSINESS_SECTION_MAX_CHARS = 50_000;

// ---------- AI output (structured) ----------

export const BusinessSuggestResultSchema = z.object({
  suggestions: z.array(
    z.object({
      key: z.enum(BusinessSectionKey),
      content: z.string().describe('Proposed section content in Markdown'),
      rationale: z
        .string()
        .describe('Why this proposal fits the business and what it is based on (1–3 sentences)'),
    }),
  ),
});
export type BusinessSuggestResult = z.infer<typeof BusinessSuggestResultSchema>;

export const BusinessCandidateSchema = z.object({
  name: z.string().describe('Official name of the real business'),
  website: z.string().describe('Official website URL, or "" if not found'),
  location: z.string().describe('City / country, or ""'),
  industry: z.string(),
  description: z.string().describe('What the business does (2–4 sentences)'),
  relevance: z.string().describe('Why it matches the keyword'),
  confidence: z.number().describe('0..1 — how sure you are this business exists as described'),
  sourceUrls: z.array(z.string()).describe('URLs from the research that support this candidate'),
});
export type BusinessCandidate = z.infer<typeof BusinessCandidateSchema>;

export const BusinessDiscoveryResultSchema = z.object({
  summary: z.string().describe('Short overview of what the research found for the keyword'),
  candidates: z.array(BusinessCandidateSchema),
});
export type BusinessDiscoveryResult = z.infer<typeof BusinessDiscoveryResultSchema>;

export const BusinessBuildResultSchema = z.object({
  name: z.string(),
  tagline: z.string().describe('One-line description / slogan, or ""'),
  industry: z.string(),
  website: z.string().describe('Official website URL, or ""'),
  location: z.string(),
  sections: z.array(
    z.object({
      key: z.enum(BusinessSectionKey),
      content: z.string().describe('Section content in Markdown'),
    }),
  ),
  gaps: z
    .array(z.string())
    .describe('Facts that could not be verified and parts the admin should complete or check'),
});
export type BusinessBuildResult = z.infer<typeof BusinessBuildResultSchema>;

// ---------- requests ----------

const optionalUrl = z
  .union([z.url({ protocol: /^https?$/ }), z.literal('')])
  .optional()
  .default('');

export const CreateBusinessSchema = z.object({
  name: z.string().trim().min(2).max(200),
  tagline: z.string().trim().max(300).optional().default(''),
  industry: z.string().trim().max(200).optional().default(''),
  website: optionalUrl,
  location: z.string().trim().max(200).optional().default(''),
  language: z.string().trim().min(2).max(10).default('fa'),
});
export type CreateBusinessInput = z.input<typeof CreateBusinessSchema>;

export const UpdateBusinessSchema = CreateBusinessSchema.partial().extend({
  status: z.enum(BusinessStatus).optional(),
});
export type UpdateBusinessInput = z.input<typeof UpdateBusinessSchema>;

export const BusinessListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(BusinessStatus).optional(),
});

export const UpdateBusinessSectionSchema = z.object({
  content: z.string().trim().max(BUSINESS_SECTION_MAX_CHARS),
});
export type UpdateBusinessSectionInput = z.infer<typeof UpdateBusinessSectionSchema>;

export const SuggestBusinessSchema = z.object({
  /** Sections to propose; empty = every section that is still empty. */
  keys: z.array(z.enum(BusinessSectionKey)).max(BusinessSectionKey.length).default([]),
  instruction: z.string().trim().max(2000).optional().default(''),
  /** Research the business on the web before proposing (slower, costs more). */
  useWebSearch: z.boolean().default(false),
});
export type SuggestBusinessInput = z.input<typeof SuggestBusinessSchema>;

export const BuildBusinessSchema = z.object({
  instruction: z.string().trim().max(2000).optional().default(''),
});
export type BuildBusinessInput = z.input<typeof BuildBusinessSchema>;

export const AcceptSuggestionSchema = z.object({
  /** Edited text; omitted = accept the proposal as is. */
  content: z.string().trim().max(BUSINESS_SECTION_MAX_CHARS).optional(),
});
export type AcceptSuggestionInput = z.infer<typeof AcceptSuggestionSchema>;

export const DiscoverBusinessesSchema = z.object({
  keyword: z.string().trim().min(2).max(200),
  location: z.string().trim().max(200).optional().default(''),
  language: z.string().trim().min(2).max(10).default('fa'),
  count: z.number().int().min(1).max(10).default(5),
  notes: z.string().trim().max(2000).optional().default(''),
});
export type DiscoverBusinessesInput = z.input<typeof DiscoverBusinessesSchema>;

export const SelectCandidateSchema = z.object({
  index: z.number().int().min(0).max(50),
});
export type SelectCandidateInput = z.infer<typeof SelectCandidateSchema>;

// ---------- responses ----------

export interface WebSource {
  url: string;
  title: string;
}

export interface BusinessSection {
  id: string;
  businessId: string;
  key: BusinessSectionKey;
  content: string;
  source: SectionSource;
  updatedAt: string;
  updatedBy?: { id: string; name: string } | null;
}

export interface BusinessSectionRevision {
  id: string;
  sectionId: string;
  content: string;
  source: SectionSource;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

export interface BusinessSuggestion {
  id: string;
  businessId: string;
  key: BusinessSectionKey;
  content: string;
  rationale: string;
  status: SuggestionStatus;
  jobId: string | null;
  createdAt: string;
}

export interface Business {
  id: string;
  name: string;
  tagline: string;
  industry: string;
  website: string;
  location: string;
  language: string;
  keyword: string | null;
  status: BusinessStatus;
  origin: BusinessOrigin;
  buildState: BusinessBuildState;
  buildError: string | null;
  lastJobId: string | null;
  sources: WebSource[];
  /** Unverified facts / gaps reported by the last research build. */
  gaps: string[];
  researchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Number of non-empty sections (list responses). */
  filledSections?: number;
  _count?: { topics: number };
  sections?: BusinessSection[];
  topics?: { id: string; title: string; status: string }[];
  pendingSuggestions?: number;
}

export interface BusinessDiscovery {
  id: string;
  keyword: string;
  location: string;
  language: string;
  count: number;
  notes: string;
  status: DiscoveryStatus;
  summary: string;
  candidates: BusinessCandidate[];
  sources: WebSource[];
  selectedIndex: number | null;
  businessId: string | null;
  jobId: string | null;
  error: string | null;
  createdAt: string;
}

/** Share of the profile sections that have content (0..1). */
export function businessCompleteness(sections: Pick<BusinessSection, 'content'>[]): number {
  const filled = sections.filter((s) => s.content.trim().length > 0).length;
  return filled / BusinessSectionKey.length;
}
