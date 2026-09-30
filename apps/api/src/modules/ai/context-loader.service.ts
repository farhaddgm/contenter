import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** What `formatBusiness` needs: the sections and the usable brand assets (newest first). */
export const BUSINESS_PROMPT_INCLUDE = {
  sections: { select: { key: true, content: true } },
  assets: {
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { kind: true, title: true, description: true, analysis: true },
  },
} satisfies Prisma.BusinessInclude;

/**
 * Loads the shared context every generative task needs: the linked business, principles, brand
 * documents and the active profile.
 */
@Injectable()
export class ContextLoader {
  constructor(private readonly prisma: PrismaService) {}

  /** Active topic principles followed by active global principles. */
  principles(topicId: string) {
    return this.prisma.principle.findMany({
      where: { isActive: true, OR: [{ topicId }, { topicId: null }] },
      orderBy: [
        { topicId: { sort: 'desc', nulls: 'last' } },
        { order: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /** Active brand documents of the topic, oldest first (stable prompt prefix). */
  brandDocs(topicId: string) {
    return this.prisma.brandDocument.findMany({
      where: { topicId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, title: true, content: true },
    });
  }

  /** The business linked to the topic with its sections (the whole profile), or null. */
  async business(topicId: string) {
    const topic = await this.prisma.topic.findUniqueOrThrow({
      where: { id: topicId },
      select: { businessId: true },
    });
    if (!topic.businessId) return null;
    return this.businessById(topic.businessId);
  }

  businessById(businessId: string) {
    return this.prisma.business.findUnique({
      where: { id: businessId },
      include: BUSINESS_PROMPT_INCLUDE,
    });
  }

  /** Active notes of the business, newest first (`exceptId`: the note being applied now). */
  standingNotes(businessId: string, exceptId?: string) {
    return this.prisma.businessNote.findMany({
      where: {
        businessId,
        isActive: true,
        status: { not: 'FAILED' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { text: true },
    });
  }

  /** The topic's active APPROVED profile with its traits, or null. */
  async activeProfile(topicId: string) {
    const topic = await this.prisma.topic.findUniqueOrThrow({
      where: { id: topicId },
      select: { activeProfileId: true },
    });
    if (!topic.activeProfileId) return null;
    return this.prisma.contentProfile.findFirst({
      where: { id: topic.activeProfileId, status: 'APPROVED' },
      include: { traits: { orderBy: [{ category: 'asc' }, { confidence: 'desc' }] } },
    });
  }
}
