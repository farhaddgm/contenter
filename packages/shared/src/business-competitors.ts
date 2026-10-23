/**
 * Competitor cards (docs/70-business-competitors.md, phase 1): a short, structured list the admin
 * fills in by hand. A card is never read by a prompt, an export or the similarity check; it reaches
 * the model only as text the admin pushes into the COMPETITORS section (`competitorsSectionBlock`).
 *
 * Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
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
