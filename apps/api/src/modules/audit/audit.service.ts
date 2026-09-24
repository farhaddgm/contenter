import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginationQuery } from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { paginate, toPage } from '../../common/pagination';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget: auditing must never break the main flow. */
  log(entry: AuditEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          meta: (entry.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: entry.ip ?? null,
        },
      })
      .catch((err) => this.logger.warn(`audit write failed: ${err}`));
  }

  async list(query: PaginationQuery & { entityType?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: 'insensitive' } },
              { entityId: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
        ...paginate(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(items, total, query);
  }
}
