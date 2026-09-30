/**
 * Business profile knowledge beyond the Markdown sections (docs/16-business-profile-quality.md):
 *
 * - **Key facts** — exact values (prices, fees, limits, numbers, dates, contacts, license) that
 *   content may quote verbatim; each with a source, a verified flag and an optional expiry.
 * - **Terminology** — words the brand always writes one way (with the wrong variants to catch)
 *   and words it never uses (with replacements). `checkTerms` finds violations in any text
 *   deterministically, so generated content is checked by code, not by trust.
 * - **Profile audit** — BUSINESS_AUDIT: AI reviews the whole profile for contradictions, gaps,
 *   vague or risky statements and returns issues the admin can fix with one click.
 * - **Profile health** — `businessHealth` scores the profile and lists the next actions, without AI.
 *
 * Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import {
  BUSINESS_SECTION_META,
  BusinessSectionKey,
  FactCategory,
  type SectionSource,
} from './business';
import { patchOf } from './schemas';

// ─────────────────────────────── key facts ───────────────────────────────

export const BUSINESS_FACT_LIMIT = 150;

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const CreateBusinessFactSchema = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(1000),
  category: z.enum(FactCategory).default('OTHER'),
  sourceUrl: z
    .union([z.url({ protocol: /^https?$/ }), z.literal('')])
    .optional()
    .default(''),
  /** Date after which the value must no longer be used (offers, rates, campaigns). */
  validUntil: z.union([isoDate, z.literal(''), z.null()]).optional(),
  note: z.string().trim().max(500).optional().default(''),
});
export type CreateBusinessFactInput = z.input<typeof CreateBusinessFactSchema>;

export const UpdateBusinessFactSchema = patchOf(CreateBusinessFactSchema).extend({
  verified: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateBusinessFactInput = z.input<typeof UpdateBusinessFactSchema>;

export interface BusinessFact {
  id: string;
  businessId: string;
  label: string;
  value: string;
  category: FactCategory;
  sourceUrl: string;
  note: string;
  source: SectionSource;
  /** Confirmed by a person (facts the admin types are verified; AI-found ones are not). */
  verified: boolean;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy?: { id: string; name: string } | null;
}

/** Whether a fact's validity date has passed (compared by calendar day, UTC). */
export function isFactExpired(validUntil: string | Date | null | undefined, now = new Date()) {
  if (!validUntil) return false;
  const day = new Date(validUntil).toISOString().slice(0, 10);
  return day < now.toISOString().slice(0, 10);
}

// ─────────────────────────────── terminology ───────────────────────────────

/** USE = always write exactly `term` (alternatives = wrong variants) · AVOID = never write it. */
export const TermKind = ['USE', 'AVOID'] as const;
export type TermKind = (typeof TermKind)[number];

export const BUSINESS_TERM_LIMIT = 300;

export const CreateBusinessTermSchema = z.object({
  term: z.string().trim().min(1).max(120),
  kind: z.enum(TermKind).default('USE'),
  /** USE: wrong spellings/forms to catch · AVOID: words to use instead. */
  alternatives: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  note: z.string().trim().max(500).optional().default(''),
});
export type CreateBusinessTermInput = z.input<typeof CreateBusinessTermSchema>;

export const UpdateBusinessTermSchema = patchOf(CreateBusinessTermSchema).extend({
  isActive: z.boolean().optional(),
});
export type UpdateBusinessTermInput = z.input<typeof UpdateBusinessTermSchema>;

export interface BusinessTerm {
  id: string;
  businessId: string;
  term: string;
  kind: TermKind;
  alternatives: string[];
  note: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Canonical form for term matching: Arabic yeh/kaf → Persian, no diacritics or tatweel,
 * ZWNJ/NBSP → space, collapsed whitespace, lower case. "وی‌پاد", "وي پاد" and "وی  پاد" match.
 */
export function normalizeTermText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[‌‍ ‏‎]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Occurrences of `needle` as a whole word/phrase in the (already normalized) text. */
function countPhrase(normalizedText: string, needle: string): number {
  const n = normalizeTermText(needle);
  if (!n) return 0;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(n)}(?![\\p{L}\\p{N}])`, 'gu');
  return normalizedText.match(re)?.length ?? 0;
}

export type TermRule = Pick<BusinessTerm, 'term' | 'kind' | 'alternatives' | 'note'> & {
  id?: string;
  isActive?: boolean;
};

export interface TermIssue {
  termId?: string;
  kind: TermKind;
  /** The rule's term (the correct form for USE, the banned word for AVOID). */
  term: string;
  /** What was found in the text. */
  found: string;
  count: number;
  /** What to write instead. */
  replaceWith: string[];
  note: string;
}

/**
 * Deterministic terminology check (no AI): AVOID terms that appear, and wrong variants of USE
 * terms. Matching ignores case, Arabic/Persian letter variants, diacritics and ZWNJ vs space.
 */
export function checkTerms(text: string, terms: readonly TermRule[]): TermIssue[] {
  const hay = normalizeTermText(text);
  if (!hay) return [];
  const issues: TermIssue[] = [];
  for (const t of terms) {
    if (t.isActive === false) continue;
    if (t.kind === 'AVOID') {
      const count = countPhrase(hay, t.term);
      if (count) {
        issues.push({
          termId: t.id,
          kind: 'AVOID',
          term: t.term,
          found: t.term,
          count,
          replaceWith: t.alternatives,
          note: t.note,
        });
      }
      continue;
    }
    const correct = normalizeTermText(t.term);
    for (const variant of t.alternatives) {
      if (normalizeTermText(variant) === correct) continue;
      const count = countPhrase(hay, variant);
      if (count) {
        issues.push({
          termId: t.id,
          kind: 'USE',
          term: t.term,
          found: variant,
          count,
          replaceWith: [t.term],
          note: t.note,
        });
      }
    }
  }
  return issues;
}

// ─────────────────────────────── profile audit ───────────────────────────────

export const AuditSeverity = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type AuditSeverity = (typeof AuditSeverity)[number];

export const AuditIssueType = [
  'CONTRADICTION',
  'MISSING',
  'VAGUE',
  'UNSUPPORTED_CLAIM',
  'OUTDATED',
  'INCONSISTENT',
  'RISK',
  'OTHER',
] as const;
export type AuditIssueType = (typeof AuditIssueType)[number];

/** Where an audit issue points: a section, or GENERAL (facts, terminology, the whole profile). */
export const AuditTarget = [...BusinessSectionKey, 'GENERAL'] as const;
export type AuditTarget = (typeof AuditTarget)[number];

export const BusinessAuditResultSchema = z.object({
  score: z.number().describe('0–100: how ready this profile is to guide content production'),
  summary: z.string().describe('2–4 sentences for the admin: overall state and the top priority'),
  strengths: z.array(z.string()).describe('Up to 5 things the profile already does well'),
  issues: z
    .array(
      z.object({
        severity: z.enum(AuditSeverity),
        type: z.enum(AuditIssueType),
        target: z.enum(AuditTarget),
        title: z.string().describe('One short line naming the problem'),
        detail: z
          .string()
          .describe('What exactly is wrong, quoting the conflicting or weak text briefly'),
        fix: z
          .string()
          .describe(
            'A concrete instruction an AI editor can apply to fix it (what to change, where, how). If the fix needs information only the admin has, say what to ask the admin.',
          ),
      }),
    )
    .describe('At most 15 issues, most severe first; none that are merely stylistic'),
});
export type BusinessAuditResult = z.infer<typeof BusinessAuditResultSchema>;

export const AuditStatus = ['RUNNING', 'READY', 'FAILED'] as const;
export type AuditStatus = (typeof AuditStatus)[number];

/** OPEN · FIXING (a note was queued to fix it) · DISMISSED (the admin decided to ignore it). */
export const AuditIssueStatus = ['OPEN', 'FIXING', 'DISMISSED'] as const;
export type AuditIssueStatus = (typeof AuditIssueStatus)[number];

export type AuditIssue = BusinessAuditResult['issues'][number] & {
  status: AuditIssueStatus;
  noteId?: string | null;
};

export interface BusinessAudit {
  id: string;
  businessId: string;
  status: AuditStatus;
  score: number | null;
  summary: string;
  strengths: string[];
  issues: AuditIssue[];
  error: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const FixAuditIssueSchema = z.object({
  /** SUGGEST (default): proposals to accept · DIRECT: write the sections (history kept). */
  apply: z.enum(['DIRECT', 'SUGGEST']).default('SUGGEST'),
});
export type FixAuditIssueInput = z.input<typeof FixAuditIssueSchema>;

// ─────────────────────────────── profile health ───────────────────────────────

export const HealthCheckId = [
  'CORE_SECTIONS',
  'EMPTY_SECTIONS',
  'THIN_SECTIONS',
  'UNREVIEWED',
  'SUGGESTIONS',
  'FACTS',
  'UNVERIFIED_FACTS',
  'EXPIRED_FACTS',
  'TERMS',
  'ASSETS',
  'GAPS',
  'AUDIT',
] as const;
export type HealthCheckId = (typeof HealthCheckId)[number];

export interface HealthCheck {
  id: HealthCheckId;
  /** ok = done · warn = needs attention · todo = not started. */
  level: 'ok' | 'warn' | 'todo';
  count: number;
  keys?: BusinessSectionKey[];
}

export interface HealthInput {
  sections: {
    key: BusinessSectionKey;
    content: string;
    source: SectionSource;
    reviewedAt: string | Date | null;
  }[];
  pendingSuggestions: number;
  facts: { verified: boolean; isActive: boolean; validUntil: string | Date | null }[];
  terms: number;
  assets: number;
  gaps: number;
  /** Latest finished audit (null = never audited). */
  audit: { openHigh: number; open: number } | null;
  now?: Date;
}

export interface BusinessHealth {
  /** 0..100 */
  score: number;
  filled: number;
  total: number;
  /** Checks that need action first (todo/warn, core first), then the ones that are done. */
  checks: HealthCheck[];
}

/** Points of the health score (sections dominate; the rest rewards the knowledge layers). */
const POINTS = { sections: 65, facts: 10, terms: 5, assets: 5, audit: 15 } as const;

/**
 * Deterministic profile health: weighted section completeness (thin sections count half, AI text
 * nobody reviewed counts 80%) plus facts, terminology, brand assets and the AI audit, with the
 * list of next actions. Pure — used by the web sidebar and unit tests.
 */
export function businessHealth(input: HealthInput): BusinessHealth {
  const now = input.now ?? new Date();
  const byKey = new Map(input.sections.map((s) => [s.key, s]));
  const empty: BusinessSectionKey[] = [];
  const emptyCore: BusinessSectionKey[] = [];
  const thin: BusinessSectionKey[] = [];
  const unreviewed: BusinessSectionKey[] = [];
  let earned = 0;
  let possible = 0;
  for (const key of BusinessSectionKey) {
    const meta = BUSINESS_SECTION_META[key];
    possible += meta.weight;
    const s = byKey.get(key);
    const text = s?.content.trim() ?? '';
    if (!text) {
      (meta.weight === 3 ? emptyCore : empty).push(key);
      continue;
    }
    let credit = text.length < meta.minChars ? 0.5 : 1;
    if (credit < 1) thin.push(key);
    if (s!.source === 'AI' && !s!.reviewedAt) {
      unreviewed.push(key);
      credit *= 0.8;
    }
    earned += meta.weight * credit;
  }

  const activeFacts = input.facts.filter((f) => f.isActive);
  const expired = activeFacts.filter((f) => isFactExpired(f.validUntil, now)).length;
  const verified = activeFacts.filter((f) => f.verified && !isFactExpired(f.validUntil, now));
  const unverified = activeFacts.filter((f) => !f.verified).length;

  const score =
    (earned / possible) * POINTS.sections +
    (verified.length ? POINTS.facts : activeFacts.length ? POINTS.facts / 2 : 0) +
    (input.terms ? POINTS.terms : 0) +
    (input.assets ? POINTS.assets : 0) +
    (input.audit ? (input.audit.openHigh ? POINTS.audit * 0.4 : POINTS.audit) : 0);

  const checks: HealthCheck[] = [
    {
      id: 'CORE_SECTIONS',
      level: emptyCore.length ? 'todo' : 'ok',
      count: emptyCore.length,
      keys: emptyCore,
    },
    { id: 'EMPTY_SECTIONS', level: empty.length ? 'todo' : 'ok', count: empty.length, keys: empty },
    { id: 'THIN_SECTIONS', level: thin.length ? 'warn' : 'ok', count: thin.length, keys: thin },
    {
      id: 'UNREVIEWED',
      level: unreviewed.length ? 'warn' : 'ok',
      count: unreviewed.length,
      keys: unreviewed,
    },
    {
      id: 'SUGGESTIONS',
      level: input.pendingSuggestions ? 'warn' : 'ok',
      count: input.pendingSuggestions,
    },
    { id: 'FACTS', level: activeFacts.length ? 'ok' : 'todo', count: activeFacts.length },
    { id: 'UNVERIFIED_FACTS', level: unverified ? 'warn' : 'ok', count: unverified },
    { id: 'EXPIRED_FACTS', level: expired ? 'warn' : 'ok', count: expired },
    { id: 'TERMS', level: input.terms ? 'ok' : 'todo', count: input.terms },
    { id: 'ASSETS', level: input.assets ? 'ok' : 'todo', count: input.assets },
    { id: 'GAPS', level: input.gaps ? 'warn' : 'ok', count: input.gaps },
    {
      id: 'AUDIT',
      level: !input.audit ? 'todo' : input.audit.open ? 'warn' : 'ok',
      count: input.audit?.open ?? 0,
    },
  ];
  const rank = { todo: 0, warn: 1, ok: 2 } as const;
  checks.sort((a, b) => rank[a.level] - rank[b.level]);
  // Checks whose subject does not exist add nothing (e.g. "0 unverified facts" when no facts).
  const visible = checks.filter(
    (c) => !(c.level === 'ok' && c.count === 0 && !['CORE_SECTIONS', 'AUDIT'].includes(c.id)),
  );

  return {
    score: Math.round(Math.min(100, score)),
    filled: BusinessSectionKey.length - empty.length - emptyCore.length,
    total: BusinessSectionKey.length,
    checks: visible,
  };
}
