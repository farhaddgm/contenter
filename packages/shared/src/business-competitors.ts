/**
 * Competitor cards (docs/70-business-competitors.md, phase 1): a short, structured list the admin
 * fills in by hand. A card is never read by a prompt, an export or the similarity check; it reaches
 * the model only as text the admin pushes into the COMPETITORS section (`competitorsSectionBlock`).
 *
 * Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import { foldForEvidence } from './business-catalog';
import type { SectionSource } from './business';
import { patchOf } from './schemas';

export const CompetitorKind = ['DIRECT', 'INDIRECT', 'REFERENCE'] as const;
export type CompetitorKind = (typeof CompetitorKind)[number];

export const BUSINESS_COMPETITOR_LIMIT = 8;
export const COMPETITOR_POINTS_MAX = 6;

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => u === '' || /^https?:\/\/\S+$/i.test(u), 'Only http(s) links')
  .optional()
  .default('');

const points = z
  .array(z.string().trim().min(1).max(200))
  .max(COMPETITOR_POINTS_MAX)
  .optional()
  .default([]);

const CompetitorBase = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CompetitorKind).default('DIRECT'),
  website: optionalUrl,
  /** The account's handle or link, typed by the admin; the app never opens it. */
  instagram: z.string().trim().max(200).optional().default(''),
  positioning: z.string().trim().max(400).optional().default(''),
  pricing: z.string().trim().max(200).optional().default(''),
  strengths: points,
  weaknesses: points,
  /** How this business differs from the competitor. */
  difference: z.string().trim().max(400).optional().default(''),
  /** Internal note; never leaves the app. */
  note: z.string().trim().max(1000).optional().default(''),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});

export const CreateBusinessCompetitorSchema = CompetitorBase;
export type CreateBusinessCompetitorInput = z.input<typeof CreateBusinessCompetitorSchema>;

export const UpdateBusinessCompetitorSchema = patchOf(CompetitorBase).extend({
  isActive: z.boolean().optional(),
});
export type UpdateBusinessCompetitorInput = z.input<typeof UpdateBusinessCompetitorSchema>;

export interface BusinessCompetitor {
  id: string;
  businessId: string;
  name: string;
  kind: CompetitorKind;
  website: string;
  instagram: string;
  positioning: string;
  pricing: string;
  strengths: string[];
  weaknesses: string[];
  difference: string;
  note: string;
  isActive: boolean;
  sortOrder: number;
  /** AI proposals wait inactive and unverified until the admin confirms them. */
  source: SectionSource;
  verified: boolean;
  /** The quote from a source that backed an AI proposal. */
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

type CompetitorText = Pick<
  BusinessCompetitor,
  'name' | 'kind' | 'website' | 'positioning' | 'pricing' | 'strengths' | 'weaknesses' | 'difference'
> & { isActive?: boolean };

export const COMPETITORS_BLOCK_START = '<!-- competitors:start -->';
export const COMPETITORS_BLOCK_END = '<!-- competitors:end -->';

const KIND_LABEL: Record<CompetitorKind, string> = {
  DIRECT: 'direct competitor',
  INDIRECT: 'indirect competitor / alternative',
  REFERENCE: 'reference brand',
};

/** The Markdown for the active cards, in the order given; '' when there are none. Pure, no model. */
export function competitorsSectionBlock(rows: readonly CompetitorText[]): string {
  const active = rows.filter((r) => r.isActive !== false);
  if (!active.length) return '';
  const items = active.map((r) => {
    const lines = [`- **${r.name}** (${KIND_LABEL[r.kind]})${r.website ? ` — ${r.website}` : ''}`];
    if (r.positioning) lines.push(`  - Positioning: ${r.positioning}`);
    if (r.pricing) lines.push(`  - Pricing: ${r.pricing}`);
    if (r.strengths.length) lines.push(`  - Strengths: ${r.strengths.join('; ')}`);
    if (r.weaknesses.length) lines.push(`  - Weaknesses: ${r.weaknesses.join('; ')}`);
    if (r.difference) lines.push(`  - How we differ: ${r.difference}`);
    return lines.join('\n');
  });
  return [COMPETITORS_BLOCK_START, ...items, COMPETITORS_BLOCK_END].join('\n');
}

/**
 * Puts the generated block into the section text: replaces the previous block when there is one,
 * otherwise appends it after the admin's own text. With no block (no active card) the old block is
 * removed and the admin's text is left alone.
 */
export function mergeCompetitorsBlock(existing: string, block: string): string {
  const start = existing.indexOf(COMPETITORS_BLOCK_START);
  const end = existing.indexOf(COMPETITORS_BLOCK_END);
  if (start !== -1 && end > start) {
    const before = existing.slice(0, start).trimEnd();
    const after = existing.slice(end + COMPETITORS_BLOCK_END.length).trimStart();
    return [before, block, after].filter(Boolean).join('\n\n');
  }
  return [existing.trim(), block].filter(Boolean).join('\n\n');
}

// ─────────────────────────────── AI proposals ───────────────────────────────

/** Most cards one proposal may return. */
export const COMPETITOR_PROPOSE_MAX = 8;

/**
 * What BUSINESS_COMPETITORS_PROPOSE returns (docs/70 §11). The model reads only what the admin
 * already stored (the COMPETITORS section, key facts, references); it never looks a rival up.
 */
export const CompetitorsProposeSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().describe('The competitor as the sources name it'),
        kind: z.enum(CompetitorKind),
        website: z.string().describe('Its website only if a source states it, or ""'),
        positioning: z.string().describe('How a source says it positions itself, or ""'),
        pricing: z.string().describe('Its price level only if a source states it, or ""'),
        strengths: z.array(z.string()).describe('Strengths a source states, or []'),
        weaknesses: z.array(z.string()).describe('Weaknesses a source states, or []'),
        difference: z.string().describe('How this business differs, as a source says, or ""'),
        evidence: z.string().describe('A short exact quote from a source that names this competitor'),
      }),
    )
    .max(COMPETITOR_PROPOSE_MAX),
  notes: z.string().describe('Anything the sources leave unclear, or ""'),
});
export type CompetitorsPropose = z.infer<typeof CompetitorsProposeSchema>;

export type CompetitorProposalRow = Pick<
  BusinessCompetitor,
  | 'name'
  | 'kind'
  | 'website'
  | 'positioning'
  | 'pricing'
  | 'strengths'
  | 'weaknesses'
  | 'difference'
  | 'evidence'
>;

export type CompetitorDropReason = 'NO_NAME' | 'NO_EVIDENCE' | 'NAME_NOT_IN_QUOTE' | 'DUPLICATE' | 'LIMIT';

export interface CompetitorProposalResult {
  rows: CompetitorProposalRow[];
  dropped: { name: string; reason: CompetitorDropReason }[];
}

const EVIDENCE_MIN_CHARS = 6;
const clip = (s: string, n: number) => s.trim().slice(0, n);
const clipList = (items: readonly string[]) =>
  [...new Set(items.map((x) => clip(x, 200)).filter(Boolean))].slice(0, COMPETITOR_POINTS_MAX);

/**
 * Keeps only the cards the sources back: the quote must occur in a source and must itself name the
 * competitor (a rival the sources never mention is never a card); a name the business already has
 * is skipped; a website is kept only when it occurs in a source, and a price level or strength the
 * model could not have read there is left to the admin. Pure: the model proposes, this decides.
 */
export function resolveCompetitorProposals(args: {
  proposals: CompetitorsPropose['competitors'];
  /** The source texts the model was given. */
  sources: readonly string[];
  /** Names of the cards already stored. */
  existing: readonly string[];
  /** The business's own name, never a competitor of itself. */
  ownName: string;
  room: number;
}): CompetitorProposalResult {
  const corpus = args.sources.map(foldForEvidence).join(' \n ');
  const taken = new Set([...args.existing, args.ownName].map(foldForEvidence).filter(Boolean));
  const rows: CompetitorProposalRow[] = [];
  const dropped: CompetitorProposalResult['dropped'] = [];

  for (const p of args.proposals) {
    const name = clip(p.name, 120);
    const folded = foldForEvidence(name);
    const drop = (reason: CompetitorDropReason) => dropped.push({ name: name || '—', reason });
    if (!folded) {
      drop('NO_NAME');
      continue;
    }
    const evidence = clip(p.evidence, 300);
    const foldedEvidence = foldForEvidence(evidence);
    if (foldedEvidence.length < EVIDENCE_MIN_CHARS || !corpus.includes(foldedEvidence)) {
      drop('NO_EVIDENCE');
      continue;
    }
    if (!foldedEvidence.includes(folded)) {
      drop('NAME_NOT_IN_QUOTE');
      continue;
    }
    if (taken.has(folded)) {
      drop('DUPLICATE');
      continue;
    }
    if (rows.length >= args.room) {
      drop('LIMIT');
      continue;
    }
    taken.add(folded);
    const website = clip(p.website, 2000);
    rows.push({
      name,
      kind: p.kind,
      website: /^https?:\/\/\S+$/i.test(website) && corpus.includes(foldForEvidence(website)) ? website : '',
      positioning: clip(p.positioning, 400),
      pricing: clip(p.pricing, 200),
      strengths: clipList(p.strengths),
      weaknesses: clipList(p.weaknesses),
      difference: clip(p.difference, 400),
      evidence,
    });
  }
  return { rows, dropped };
}
