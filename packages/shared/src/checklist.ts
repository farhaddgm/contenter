/**
 * The publishing checklist (docs/45-publish-checklist.md): points a person must confirm before a
 * content goes on the calendar ("is the link in the bio updated?"). The admin writes the points per
 * business (and, if wanted, per platform); the people who review tick them per content. Code only.
 */
import { z } from 'zod';
import { Platform } from './enums';

export const CHECKLIST_MAX_ITEMS = 10;
export const CHECKLIST_ITEM_MAX_CHARS = 160;

/**
 * A point the server can answer by itself. It is shown ticked or not, never asks a person, and
 * never blocks (like the quality gate it warns, docs/41).
 */
export const ChecklistAuto = ['QUALITY_CLEAN'] as const;
export type ChecklistAuto = (typeof ChecklistAuto)[number];

export const ChecklistItemSchema = z
  .object({
    /** Kept when the point is edited, so a tick stays with its point. Assigned by the server. */
    id: z.string().trim().min(1).max(40).optional(),
    text: z.string().trim().min(2).max(CHECKLIST_ITEM_MAX_CHARS),
    /** An open required point stops the content from being scheduled. */
    required: z.boolean().default(false),
    auto: z.enum(ChecklistAuto).nullable().default(null),
  })
  .refine((i) => !(i.auto && i.required), {
    message: 'An automatic point cannot be required',
    path: ['required'],
  });
export type ChecklistItemInput = z.input<typeof ChecklistItemSchema>;

export const ChecklistTemplateInputSchema = z.object({
  /** null = the points apply to every platform of the business. */
  platform: z.enum(Platform).nullable(),
  items: z.array(ChecklistItemSchema).max(CHECKLIST_MAX_ITEMS),
});

export const SaveChecklistsSchema = z
  .object({ templates: z.array(ChecklistTemplateInputSchema).max(Platform.length + 1) })
  .refine((v) => new Set(v.templates.map((t) => t.platform)).size === v.templates.length, {
    message: 'Each platform can have only one checklist',
    path: ['templates'],
  });
export type SaveChecklistsInput = z.input<typeof SaveChecklistsSchema>;

export interface ChecklistItem {
  id: string;
  text: string;
  required: boolean;
  auto: ChecklistAuto | null;
}

export interface ChecklistTemplate {
  platform: Platform | null;
  items: ChecklistItem[];
}

/** One point of a content's checklist with its state. */
export interface ContentChecklistItem extends ChecklistItem {
  checked: boolean;
  checkedAt: string | null;
  checkedByName: string | null;
}

export interface ContentChecklist {
  items: ContentChecklistItem[];
  /** Required points not ticked yet; scheduling the content answers 409 while this is above 0. */
  requiredOpen: number;
}

export const ToggleChecklistItemSchema = z.object({ checked: z.boolean() });
export type ToggleChecklistItemInput = z.infer<typeof ToggleChecklistItemSchema>;

/**
 * The points a content has: the business's general points first, then those of its platform.
 * A point written for the platform that repeats a general one (same words) is not shown twice.
 */
export function checklistItemsFor(
  templates: ChecklistTemplate[],
  platform: Platform,
): ChecklistItem[] {
  const general = templates.find((t) => t.platform === null)?.items ?? [];
  const specific = templates.find((t) => t.platform === platform)?.items ?? [];
  const seen = new Set(general.map((i) => i.text.trim()));
  return [...general, ...specific.filter((i) => !seen.has(i.text.trim()))];
}

export const requiredOpenCount = (items: Pick<ContentChecklistItem, 'required' | 'checked'>[]) =>
  items.filter((i) => i.required && !i.checked).length;
