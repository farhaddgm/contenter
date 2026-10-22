import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessSectionKey,
  DOCOO_EXPORT_SCHEMA_VERSION,
  type DocooBusinessListQuery,
  type DocooBusinessSummary,
} from '@contenter/shared';
import { toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { BusinessApi } from '../businesses/business-api';
import { buildDocooExport } from './docoo-export.builder';

@Injectable()
export class DocooExportService {
  constructor(
    private readonly audit: AuditService,
    private readonly businesses: BusinessApi,
  ) {}

  async ping(allowedIds?: string[]) {
    const businesses = await this.businesses.countAll(allowedIds);
    return {
      ok: true,
      service: 'contenter',
      schemaVersion: DOCOO_EXPORT_SCHEMA_VERSION,
      businesses,
    };
  }

  /** The businesses a project can be linked to: light rows, newest change first. */
  async list(query: DocooBusinessListQuery, allowedIds?: string[]) {
    const { rows, total } = await this.businesses.listSummaries(query, allowedIds);
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
    const business = await this.businesses.findForExport(id);
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
