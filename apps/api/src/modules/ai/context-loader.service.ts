import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

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
      include: { sections: { select: { key: true, content: true } } },
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
