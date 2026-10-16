import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import {
  EXPORT_MAX_ITEMS,
  contentToMarkdown,
  contentsToCsv,
  contentsToMarkdown,
  effectivePlatform,
  exportFileName,
  exportSlug,
  type ExportContentsRequest,
  type ExportFormat,
  type ExportRow,
} from '@contenter/shared';
import { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildContentOrderBy, buildContentWhere } from '../contents/content-filters';
import { contentsToDocx } from './docx';

export interface ExportFile {
  data: Buffer;
  contentType: string;
  /** The real name (may be Persian); sent as the UTF-8 `filename*`. */
  fileName: string;
  /** A plain ASCII name for clients that ignore `filename*`. */
  asciiName: string;
}

const TYPES: Record<ExportFormat, { type: string; ext: string }> = {
  markdown: { type: 'text/markdown; charset=utf-8', ext: 'md' },
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  docx: {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  zip: { type: 'application/zip', ext: 'zip' },
};

const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

/**
 * Bulk export (docs/55-bulk-export.md): the current version of the contents the caller may see,
 * as Markdown, CSV, DOCX or a ZIP of all three. Code only, no AI, built in memory (at most
 * `EXPORT_MAX_ITEMS` contents), nothing stored.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** `data` is the request after `ExportContentsSchema` (the controller's pipe); it is not parsed again. */
  async export(user: AuthUser, data: ExportContentsRequest): Promise<ExportFile> {
    const rows = await this.rows(user, data);
    if (!rows.length)
      throw new ConflictException('Nothing to export: no matching content has a draft');

    const file = await this.build(data.format, rows);
    this.audit.log({
      userId: user.id,
      action: 'contents.export',
      entityType: 'Content',
      meta: {
        count: rows.length,
        format: data.format,
        by: data.ids ? 'ids' : 'filter',
        onlyApproved: data.onlyApproved,
      },
    });
    return file;
  }

  private async rows(user: AuthUser, data: ExportContentsRequest): Promise<ExportRow[]> {
    const visible = this.access.visibleTopics(user);
    const and: Prisma.ContentWhereInput[] = [{ currentVersionId: { not: null } }];
    if (data.onlyApproved)
      and.push({ OR: [{ status: 'APPROVED' }, { publishedAt: { not: null } }] });

    let where: Prisma.ContentWhereInput;
    let orderBy: Prisma.ContentOrderByWithRelationInput[] = [{ createdAt: 'asc' }, { id: 'asc' }];
    if (data.ids) {
      const ids = [...new Set(data.ids)];
      where = { AND: [{ id: { in: ids } }, ...(visible ? [{ topic: visible }] : []), ...and] };
      const found = await this.prisma.content.findMany({
        where: { id: { in: ids }, ...(visible ? { topic: visible } : {}) },
        select: { id: true },
      });
      // every requested id must exist and be visible: no partial export, and no way to tell "hidden" from "missing"
      if (found.length !== ids.length) throw new NotFoundException('Content not found');
    } else {
      // the filter was already parsed by the request schema; paging does not apply to an export
      const query = { ...data.filter!, page: 1, pageSize: EXPORT_MAX_ITEMS };
      where = { AND: [buildContentWhere(query, visible), ...and] };
      orderBy = buildContentOrderBy(query.sort, query.order);
    }

    const items = await this.prisma.content.findMany({
      where,
      orderBy,
      take: EXPORT_MAX_ITEMS + 1,
      select: {
        id: true,
        status: true,
        format: true,
        platform: true,
        scheduledAt: true,
        publishedAt: true,
        createdAt: true,
        topic: { select: { title: true, platform: true } },
        currentVersion: {
          select: { version: true, title: true, body: true, hashtags: true, cta: true },
        },
      },
    });
    if (items.length > EXPORT_MAX_ITEMS) {
      throw new BadRequestException(
        `More than ${EXPORT_MAX_ITEMS} contents match; narrow the filter`,
      );
    }
    const mapped = items.flatMap((c) => {
      const v = c.currentVersion;
      if (!v) return [];
      const row: ExportRow = {
        id: c.id,
        topic: c.topic.title,
        platform: effectivePlatform(c, c.topic),
        format: c.format,
        status: c.status,
        version: v.version,
        title: v.title,
        body: v.body,
        hashtags: v.hashtags,
        cta: v.cta,
        scheduledAt: c.scheduledAt?.toISOString() ?? null,
        publishedAt: c.publishedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      };
      return [row];
    });
    // ids come back in the order they were asked for
    if (data.ids) {
      const pos = new Map(data.ids.map((id, i) => [id, i]));
      mapped.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    }
    return mapped;
  }

  private async build(format: ExportFormat, rows: ExportRow[]): Promise<ExportFile> {
    const { type, ext } = TYPES[format];
    // one content is named after its title; several share one name; a ZIP is always the same name
    const stem =
      format === 'zip'
        ? 'contenter-export'
        : rows.length === 1
          ? exportSlug(rows[0]!.title)
          : 'contenter-contents';
    const fileName = `${stem}.${ext}`;
    const asciiName = `${format === 'zip' ? 'contenter-export' : 'contenter-contents'}.${ext}`;
    switch (format) {
      case 'csv':
        return {
          data: Buffer.from(contentsToCsv(rows), 'utf8'),
          contentType: type,
          fileName,
          asciiName,
        };
      case 'markdown':
        return {
          data: Buffer.from(contentsToMarkdown(rows), 'utf8'),
          contentType: type,
          fileName,
          asciiName,
        };
      case 'docx':
        return { data: await contentsToDocx(rows), contentType: type, fileName, asciiName };
      case 'zip': {
        const zip = new JSZip();
        const opts = { date: FIXED_DATE, createFolders: false };
        rows.forEach((r, i) =>
          zip.file(exportFileName(i, r.title, 'md'), contentToMarkdown(r), opts),
        );
        zip.file('contents.csv', contentsToCsv(rows), opts);
        zip.file('contents.docx', await contentsToDocx(rows), opts);
        return {
          data: await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
          }),
          contentType: type,
          fileName,
          asciiName,
        };
      }
    }
  }
}
