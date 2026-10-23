import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  isWriteBlocked,
  type BusinessSectionKey,
  type SectionActor,
  type SectionLock,
  type SectionSource,
} from '@contenter/shared';

/**
 * The section's lock does not let this writer change it (docs/69-business-section-lock.md). A
 * person gets a 403; an AI runner is expected to turn its text into a suggestion first
 * (`aiMustSuggest`), so seeing this error there means a path forgot to.
 */
export class SectionLockedError extends ForbiddenException {
  constructor(
    readonly key: BusinessSectionKey,
    readonly lock: SectionLock,
  ) {
    super(
      lock === 'ADMIN_ONLY'
        ? 'This section is locked: only an admin can change it'
        : 'This section is locked against direct AI writes',
    );
  }
}

/**
 * Sets a section's content. The previous non-empty content is kept as a revision (restorable),
 * so neither the admin nor an AI build can silently lose text. No-op when nothing changes.
 *
 * Review state: text a person wrote or accepted counts as reviewed by them (`reviewed`, default
 * = written by the admin); AI text written directly starts unreviewed until the admin confirms it.
 *
 * Lock (docs/69): the single place every write goes through, so it enforces who may change a
 * locked section (`actor`). The update only applies if the lock is still the one that was
 * checked, so a lock set while this runs is respected, not overwritten.
 */
export async function writeSection(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string;
    key: BusinessSectionKey;
    content: string;
    source: SectionSource;
    userId: string | null;
    /** Who is writing: the AI, or a person with their role. */
    actor: SectionActor;
    /** A person approved this text (default: source ADMIN). */
    reviewed?: boolean;
  },
) {
  const reviewed = args.reviewed ?? args.source === 'ADMIN';
  const review = {
    reviewedAt: reviewed ? new Date() : null,
    reviewedById: reviewed ? args.userId : null,
  };
  const where = { businessId_key: { businessId: args.businessId, key: args.key } };
  const existing = await tx.businessSection.findUnique({ where });
  if (existing && existing.content === args.content && existing.source === args.source) {
    // Same text approved by a person now → just record the review.
    if (reviewed && !existing.reviewedAt) {
      return tx.businessSection.update({ where, data: review });
    }
    return existing;
  }
  if (existing && isWriteBlocked(existing.lock, args.actor)) {
    throw new SectionLockedError(args.key, existing.lock);
  }
  if (existing?.content.trim()) {
    await tx.businessSectionRevision.create({
      data: {
        sectionId: existing.id,
        content: existing.content,
        source: existing.source,
        createdById: existing.updatedById,
      },
    });
  }
  const data = {
    content: args.content,
    source: args.source,
    updatedById: args.userId,
    ...review,
  };
  if (existing) {
    // compare-and-set on the lock that was checked above
    const done = await tx.businessSection.updateMany({
      where: { id: existing.id, lock: existing.lock },
      data,
    });
    if (done.count === 0) throw new SectionLockedError(args.key, existing.lock);
    return tx.businessSection.findUniqueOrThrow({ where: { id: existing.id } });
  }
  return tx.businessSection.upsert({
    where,
    create: { businessId: args.businessId, key: args.key, ...data },
    update: data,
  });
}

/** Normalizes a URL the model returned; anything that is not http(s) becomes "". */
export function cleanUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}
