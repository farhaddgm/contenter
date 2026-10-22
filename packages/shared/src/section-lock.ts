/**
 * Locking a business profile section (docs/69-business-section-lock.md): who may change its text.
 * The rule is pure and lives here so the server (one writer, `writeSection`), the AI runners and
 * the web all read the same one. Enums mirror `apps/api/prisma/schema.prisma`.
 *
 * - NONE: anyone with EDIT on the business, and the AI.
 * - AI_ONLY: the AI never writes the section directly (its text becomes a suggestion); people
 *   with EDIT still can.
 * - ADMIN_ONLY: as AI_ONLY, and only an admin can edit, restore or accept a suggestion into it.
 */
import { z } from 'zod';

export const SectionLock = ['NONE', 'AI_ONLY', 'ADMIN_ONLY'] as const;
export type SectionLock = (typeof SectionLock)[number];

export const SECTION_LOCK_NOTE_MAX = 200;

export const SetSectionLockSchema = z.object({
  lock: z.enum(SectionLock),
  /** Why, for whoever meets the lock later; ignored when unlocking. */
  note: z.string().trim().max(SECTION_LOCK_NOTE_MAX).optional().default(''),
});
export type SetSectionLockInput = z.input<typeof SetSectionLockSchema>;

/** Who is writing a section. */
export type SectionActor = { kind: 'AI' } | { kind: 'USER'; role: string };

/** Whether `actor` may not change the text of a section with this lock. */
export function isWriteBlocked(lock: SectionLock, actor: SectionActor): boolean {
  if (lock === 'NONE') return false;
  if (actor.kind === 'AI') return true;
  return lock === 'ADMIN_ONLY' && actor.role !== 'ADMIN';
}

/** The AI must propose, not write: the section has any lock. */
export const aiMustSuggest = (lock: SectionLock | null | undefined): boolean =>
  !!lock && lock !== 'NONE';
