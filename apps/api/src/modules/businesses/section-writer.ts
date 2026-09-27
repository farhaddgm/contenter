import type { Prisma } from '@prisma/client';
import type { BusinessSectionKey, SectionSource } from '@contenter/shared';

/**
 * Sets a section's content. The previous non-empty content is kept as a revision (restorable),
 * so neither the admin nor an AI build can silently lose text. No-op when nothing changes.
 */
export async function writeSection(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string;
    key: BusinessSectionKey;
    content: string;
    source: SectionSource;
    userId: string | null;
  },
) {
  const where = { businessId_key: { businessId: args.businessId, key: args.key } };
  const existing = await tx.businessSection.findUnique({ where });
  if (existing && existing.content === args.content && existing.source === args.source) {
    return existing;
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
  return tx.businessSection.upsert({
    where,
    create: {
      businessId: args.businessId,
      key: args.key,
      content: args.content,
      source: args.source,
      updatedById: args.userId,
    },
    update: { content: args.content, source: args.source, updatedById: args.userId },
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
