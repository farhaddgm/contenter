/**
 * Audiences of a business (docs/73-offering-hierarchy.md): a market segment ("small shops in
 * Tehran") or a persona ("a salaried employee who needs equipment"), typed by the admin and linked
 * to the offerings it is for. The profile sections `TARGET_MARKET` / `PERSONAS` stay the narrative;
 * this is the structured side that a focused prompt reads (docs/73 §4, a later phase).
 *
 * Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import { foldForEvidence } from './business-catalog';
import type { SectionSource } from './business';
import { patchOf } from './schemas';

export const SegmentKind = ['MARKET', 'PERSONA'] as const;
export type SegmentKind = (typeof SegmentKind)[number];

export const BUSINESS_SEGMENT_LIMIT = 40;
export const SEGMENT_POINTS_MAX = 6;
/** Audiences one offering can be linked to. */
export const OFFERING_SEGMENTS_MAX = 8;
/** 1 = secondary audience · 2 = main audience. */
export const SEGMENT_FIT_MAX = 2;

const points = z
  .array(z.string().trim().min(1).max(200))
  .max(SEGMENT_POINTS_MAX)
  .optional()
  .default([]);

const SegmentBase = z.object({
  kind: z.enum(SegmentKind).default('PERSONA'),
  name: z.string().trim().min(1).max(120),
  /** Who they are: demographics and context for a persona; geography, size, B2B/B2C for a market. */
  summary: z.string().trim().max(400).optional().default(''),
  goals: points,
  pains: points,
  objections: points,
  /** Where they read, watch or ask. */
  channels: points,
  /** What message convinces them. */
  messageAngle: z.string().trim().max(400).optional().default(''),
  /** Internal note; never sent to a model or an integration. */
  note: z.string().trim().max(1000).optional().default(''),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});

export const CreateBusinessSegmentSchema = SegmentBase;
export type CreateBusinessSegmentInput = z.input<typeof CreateBusinessSegmentSchema>;

export const UpdateBusinessSegmentSchema = patchOf(SegmentBase).extend({
  isActive: z.boolean().optional(),
});
export type UpdateBusinessSegmentInput = z.input<typeof UpdateBusinessSegmentSchema>;

export interface BusinessSegment {
  id: string;
  businessId: string;
  kind: SegmentKind;
  name: string;
  summary: string;
  goals: string[];
  pains: string[];
  objections: string[];
  channels: string[];
  messageAngle: string;
  note: string;
  /** Only active rows reach a prompt, the coverage report and the exports; an AI proposal starts inactive. */
  isActive: boolean;
  sortOrder: number;
  source: SectionSource;
  /** Confirmed by a person (rows the admin types are; AI-proposed ones are not until confirmed). */
  verified: boolean;
  /** The text in a source that backs an AI-proposed audience. */
  evidence: string;
  /** Offerings this audience is linked to (filled by the list endpoint). */
  offeringIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** One audience of an offering and how strong the fit is. */
export const OfferingSegmentLinkSchema = z.object({
  segmentId: z.string().trim().min(1).max(64),
  fit: z.number().int().min(1).max(SEGMENT_FIT_MAX).default(2),
});
export type OfferingSegmentLink = z.infer<typeof OfferingSegmentLinkSchema>;

/** `PUT /business-offerings/:id/segments`: replaces the offering's audiences. */
export const SetOfferingSegmentsSchema = z.object({
  links: z
    .array(OfferingSegmentLinkSchema)
    .max(OFFERING_SEGMENTS_MAX)
    .refine((l) => new Set(l.map((x) => x.segmentId)).size === l.length, 'An audience can be linked once'),
});
export type SetOfferingSegmentsInput = z.input<typeof SetOfferingSegmentsSchema>;

/** Main audiences first, then the admin's order of the list. */
export const orderSegmentLinks = (links: readonly OfferingSegmentLink[]): OfferingSegmentLink[] =>
  [...links].sort((a, b) => b.fit - a.fit);

// ─────────────────────────────── AI proposals ───────────────────────────────

/** Most audiences one proposal may return. */
export const SEGMENT_PROPOSE_MAX = 12;

/** What BUSINESS_SEGMENTS_PROPOSE returns (the runner checks every row with code before saving). */
export const SegmentsProposeSchema = z.object({
  segments: z
    .array(
      z.object({
        kind: z.enum(SegmentKind),
        name: z.string().describe('A short label for the market or persona'),
        summary: z.string().describe('Who they are, from the sources, or ""'),
        goals: z.array(z.string()).describe('What they want, or []'),
        pains: z.array(z.string()).describe('What hurts, or []'),
        objections: z.array(z.string()).describe('Why they hesitate, or []'),
        channels: z.array(z.string()).describe('Where they read, watch or ask, or []'),
        messageAngle: z.string().describe('What message the sources suggest convinces them, or ""'),
        offerings: z
          .array(
            z.object({
              name: z.string().describe('A catalog offering from <catalog>, exactly as listed'),
              fit: z.number().describe('2 = main audience of it, 1 = secondary'),
            }),
          )
          .describe('Catalog offerings this audience is for, or []'),
        evidence: z.string().describe('A short exact quote from a source that shows this audience'),
      }),
    )
    .max(SEGMENT_PROPOSE_MAX),
  notes: z.string().describe('Anything the sources leave unclear, or ""'),
});
export type SegmentsPropose = z.infer<typeof SegmentsProposeSchema>;

export interface SegmentProposalRow {
  kind: SegmentKind;
  name: string;
  summary: string;
  goals: string[];
  pains: string[];
  objections: string[];
  channels: string[];
  messageAngle: string;
  evidence: string;
  /** Existing offerings the audience is linked to. */
  links: { offeringId: string; fit: number }[];
}

export type SegmentDropReason = 'NO_NAME' | 'NO_EVIDENCE' | 'DUPLICATE' | 'LIMIT';

export interface SegmentProposalResult {
  rows: SegmentProposalRow[];
  dropped: { name: string; reason: SegmentDropReason }[];
  /** Offering names the model gave that are not in the catalog (their links were left out). */
  unknownOfferings: string[];
}

const EVIDENCE_MIN_CHARS = 6;
const clip = (s: string, n: number) => s.trim().slice(0, n);
const clipList = (items: readonly string[]) =>
  [...new Set(items.map((x) => clip(x, 200)).filter(Boolean))].slice(0, SEGMENT_POINTS_MAX);

/**
 * Turns the model's audience proposals into rows, keeping only what the sources back (docs/73 §6 F):
 * a row needs a quote that really occurs in a source and a name nothing else has; links are kept
 * only for offerings that exist in the catalog (matched by name or alias). Unlike an offering, an
 * audience name need not occur in the sources — a persona is a label the model coins — which is why
 * the row waits, inactive, for the admin to confirm it. Pure: the model proposes, this decides.
 */
export function resolveSegmentProposals(args: {
  proposals: SegmentsPropose['segments'];
  /** The source texts the model was given. */
  sources: readonly string[];
  /** Names of the audiences already stored. */
  existing: readonly string[];
  /** Offerings of the business the links may point to. */
  offerings: readonly { id: string; name: string; aliases: readonly string[] }[];
  /** How many more rows the business can take. */
  room: number;
}): SegmentProposalResult {
  const corpus = args.sources.map(foldForEvidence).join(' \n ');
  const taken = new Set(args.existing.map(foldForEvidence).filter(Boolean));
  const byName = new Map<string, string>();
  for (const o of args.offerings) {
    for (const n of [o.name, ...o.aliases]) {
      const key = foldForEvidence(n);
      if (key && !byName.has(key)) byName.set(key, o.id);
    }
  }
  const rows: SegmentProposalRow[] = [];
  const dropped: SegmentProposalResult['dropped'] = [];
  const unknown = new Set<string>();

  for (const p of args.proposals) {
    const name = clip(p.name, 120);
    const folded = foldForEvidence(name);
    const drop = (reason: SegmentDropReason) => dropped.push({ name: name || '—', reason });
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
    if (taken.has(folded)) {
      drop('DUPLICATE');
      continue;
    }
    if (rows.length >= args.room) {
      drop('LIMIT');
      continue;
    }
    taken.add(folded);

    const links = new Map<string, number>();
    for (const o of p.offerings) {
      const id = byName.get(foldForEvidence(o.name));
      if (!id) {
        if (o.name.trim()) unknown.add(clip(o.name, 120));
        continue;
      }
      if (!links.has(id)) links.set(id, o.fit === 1 ? 1 : 2);
    }
    rows.push({
      kind: p.kind,
      name,
      summary: clip(p.summary, 400),
      goals: clipList(p.goals),
      pains: clipList(p.pains),
      objections: clipList(p.objections),
      channels: clipList(p.channels),
      messageAngle: clip(p.messageAngle, 400),
      evidence,
      links: [...links].map(([offeringId, fit]) => ({ offeringId, fit })),
    });
  }
  return { rows, dropped, unknownOfferings: [...unknown] };
}

