import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BusinessSectionKey,
  DOCOO_EXPORT_SCHEMA_VERSION,
  type DocooBusinessListQuery,
  type DocooBusinessSummary,
} from '@contenter/shared';
import { paginate, toPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildDocooExport, EXPORT_INCLUDE } from './docoo-export.builder';

@Injectable()
export class DocooExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async ping(allowedIds?: string[]) {
    const businesses = await this.prisma.business.count(allowedIds === undefined ? undefined : { where: { id: { in: allowedIds } } });
    return {
      ok: true,
      service: 'contenter',
      schemaVersion: DOCOO_EXPORT_SCHEMA_VERSION,
      businesses,
    };
  }

  /** The businesses a project can be linked to: light rows, newest change first. */
  async list(query: DocooBusinessListQuery, allowedIds?: string[]) {
    const where: Prisma.BusinessWhereInput = {
      ...(allowedIds === undefined ? {} : { id: { in: allowedIds } }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { industry: { contains: query.q, mode: 'insensitive' } },
              { keyword: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: {
          _count: { select: { topics: true } },
          sections: { select: { content: true } },
        },
        ...paginate(query),
      }),
      this.prisma.business.count({ where }),
    ]);
    const items: DocooBusinessSummary[] = rows.map((b) => ({
      id: b.id,
      name: b.name,
      tagline: b.tagline,
      industry: b.industry,
      website: b.website,
      location: b.location,
      language: b.language,
      status: b.status,
      filledSections: b.sections.filter((s) => s.content.trim()).length,
      totalSections: BusinessSectionKey.length,
      topics: b._count.topics,
      updatedAt: b.updatedAt.toISOString(),
    }));
    return toPage(items, total, query);
  }

  async export(id: string, ip: string | null, consumer: 'docoo' | 'researcher' = 'docoo') {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: EXPORT_INCLUDE,
    });
    if (!business) throw new NotFoundException('Business not found');
    this.audit.log({
      action: `integration.${consumer}_export`,
      entityType: 'Business',
      entityId: id,
      meta: { schemaVersion: DOCOO_EXPORT_SCHEMA_VERSION },
      ip,
    });
    return buildDocooExport(business);
  }
}
