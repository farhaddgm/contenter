/**
 * Service API for other applications (Docoo): a read-only, token-protected export of a business
 * with everything contenter knows about it. See docs/18-docoo-integration.md.
 */
import { z } from 'zod';
import { BusinessStatus, type BusinessSectionKey } from './business';
import type { BusinessAssetAnalysis } from './business-assets';
import type { AuditIssue, BusinessHealth } from './business-profile';
import { PaginationQuerySchema } from './schemas';

/** Bumped only for changes that break readers; new fields are additive. */
export const DOCOO_EXPORT_SCHEMA_VERSION = 1;

export const DocooBusinessListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(BusinessStatus).optional(),
});
export type DocooBusinessListQuery = z.infer<typeof DocooBusinessListQuerySchema>;

/** Longest text excerpt of a reference or an asset in the export (the full text stays here). */
export const DOCOO_EXPORT_EXCERPT_CHARS = 2000;

export interface DocooBusinessSummary {
  id: string;
  name: string;
  tagline: string;
  industry: string;
  website: string;
  location: string;
  language: string;
  status: string;
  filledSections: number;
  totalSections: number;
  topics: number;
  updatedAt: string;
}

export interface DocooBusinessExport {
  schemaVersion: typeof DOCOO_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  business: {
    id: string;
    name: string;
    tagline: string;
    industry: string;
    website: string;
    location: string;
    language: string;
    status: string;
    origin: string;
    keyword: string | null;
    buildState: string;
    researchedAt: string | null;
    createdAt: string;
    updatedAt: string;
    /** Web sources of the last research build. */
    sources: { url: string; title: string }[];
    /** Unverified items / gaps the last research build reported. */
    gaps: string[];
  };
  /** Every section of the registry, in prompt order; empty ones have `content: ''`. */
  sections: {
    key: BusinessSectionKey | string;
    content: string;
    source: 'ADMIN' | 'AI';
    /** null = AI text no person has confirmed yet. */
    reviewedAt: string | null;
    updatedAt: string | null;
  }[];
  facts: {
    id: string;
    label: string;
    value: string;
    category: string;
    sourceUrl: string;
    note: string;
    source: 'ADMIN' | 'AI';
    verified: boolean;
    validUntil: string | null;
    isActive: boolean;
    updatedAt: string;
  }[];
  terms: {
    id: string;
    term: string;
    kind: 'USE' | 'AVOID';
    alternatives: string[];
    note: string;
    isActive: boolean;
  }[];
  notes: {
    id: string;
    text: string;
    status: string;
    summary: string;
    changedKeys: string[];
    isActive: boolean;
    createdAt: string;
  }[];
  references: {
    id: string;
    kind: string;
    url: string;
    title: string;
    status: string;
    isActive: boolean;
    fetchedAt: string | null;
    contentChars: number;
    excerpt: string;
  }[];
  assets: {
    id: string;
    kind: string;
    title: string;
    description: string;
    url: string;
    hasFile: boolean;
    fileName: string | null;
    mimeType: string | null;
    analysisStatus: string;
    analysis: BusinessAssetAnalysis | null;
    excerpt: string;
    isActive: boolean;
    createdAt: string;
  }[];
  /** The latest finished quality review, if any. */
  audit: {
    id: string;
    score: number | null;
    summary: string;
    strengths: string[];
    issues: AuditIssue[];
    createdAt: string;
  } | null;
  health: BusinessHealth;
  pendingSuggestions: number;
  /** The projects (topics) of this business in contenter. */
  topics: { id: string; title: string; status: string }[];
}
