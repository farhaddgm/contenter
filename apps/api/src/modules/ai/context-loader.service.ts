import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Loads the shared context every generative task needs: principles and the active profile. */
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
