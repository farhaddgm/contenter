/**
 * Audiences of a business (docs/73-offering-hierarchy.md): a market segment ("small shops in
 * Tehran") or a persona ("a salaried employee who needs equipment"), typed by the admin and linked
 * to the offerings it is for. The profile sections `TARGET_MARKET` / `PERSONAS` stay the narrative;
 * this is the structured side that a focused prompt reads (docs/73 §4, a later phase).
 *
 * Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
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
  isActive: boolean;
  sortOrder: number;
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
