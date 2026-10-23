import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BusinessCompetitorSource as SourceRow, Prisma } from '@prisma/client';
import {
  AddCompetitorSourceSchema,
  COMPETITOR_SOURCE_LIMIT,
  compareBrands,
  instagramProfileUrl,
  isInstagramUrl,
  parseInstagramHandle,
  type CompareReport,
  type CompetitorSourceSummary,
  type InstagramStats,
  type ReferenceAnalysis,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessApi } from './business-api';
import { SourceReader } from './social/source-reader.service';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

export const competitorSourceOf = ({ content, analysis, ...s }: SourceRow): CompetitorSourceSummary => ({
  id: s.id,
  kind: s.kind,
  url: s.url,
  title: s.title,
  status: s.status,
  error: s.error,
  fetchedAt: s.fetchedAt?.toISOString() ?? null,
  chars: content.length,
  analysis: (analysis as ReferenceAnalysis | null) ?? null,
});

/** The Instagram statistics of a source row, or null for anything else. */
const statsOf = (row: Pick<SourceRow, 'analysis'>): InstagramStats | null => {
  const a = row.analysis as { type?: string; stats?: InstagramStats } | null;
  return a?.type === 'INSTAGRAM' && a.stats ? a.stats : null;
};

/**
 * Sources of a competitor card and the comparison with the business (docs/70 phase 2). Read by
 * `SourceReader` in the request path, never by the model; the same rules as the business's own
 * references and the imitation styles (never instagram.com, Graph API or hand-typed data, no
 * comments or follower lists). Like the cards, none of it reaches a prompt, an export or similarity.
 */
@Injectable()
export class CompetitorSourcesService {
  private readonly logger = new Logger(CompetitorSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reader: SourceReader,
    private readonly businesses: BusinessApi,
  ) {}

  private log(user: AuthUser, businessId: string, action: string, meta?: Record<string, unknown>) {
    this.audit.log({
      userId: user.id,
      action: `business.competitor_${action}`,
      entityType: 'Business',
      entityId: businessId,
      meta,
    });
  }

  private async findCompetitor(id: string) {
    const row = await this.prisma.businessCompetitor.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Competitor not found');
    return row;
  }

  private async findSource(id: string) {
    const row = await this.prisma.businessCompetitorSource.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Source not found');
    return row;
  }

  async list(competitorId: string): Promise<CompetitorSourceSummary[]> {
    const rows = await this.prisma.businessCompetitorSource.findMany({
      where: { competitorId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(competitorSourceOf);
  }

  /** The stored snapshot, so the admin can see exactly what was read. */
  async text(id: string) {
    const row = await this.findSource(id);
    return { ...competitorSourceOf(row), content: row.content };
  }

  async add(competitorId: string, input: unknown, user: AuthUser): Promise<CompetitorSourceSummary> {
    const data = AddCompetitorSourceSchema.parse(input);
    const competitor = await this.findCompetitor(competitorId);
    if ((await this.prisma.businessCompetitorSource.count({ where: { competitorId } })) >= COMPETITOR_SOURCE_LIMIT) {
      throw new BadRequestException(`A competitor can have at most ${COMPETITOR_SOURCE_LIMIT} sources`);
    }

    let row: SourceRow;
    if (data.instagram) {
      const manual = this.reader.manualInstagram(data.instagram);
      row = await this.prisma.businessCompetitorSource.create({
        data: {
          competitorId,
          kind: 'INSTAGRAM',
          url: manual.url,
          title: manual.title,
          content: manual.content,
          analysis: asJson(manual.analysis),
          status: 'READY',
          fetchedAt: new Date(),
          createdById: user.id,
        },
      });
    } else if (data.content) {
      row = await this.prisma.businessCompetitorSource.create({
        data: {
          competitorId,
          kind: 'TEXT',
          title: data.title,
          content: data.content,
          status: 'READY',
          fetchedAt: new Date(),
          createdById: user.id,
        },
      });
    } else {
      const handle = isInstagramUrl(data.url!) ? parseInstagramHandle(data.url!) : null;
      if (isInstagramUrl(data.url!) && !handle) {
        throw new BadRequestException(
          'This Instagram link is a post, reel or story, not an account. Send the account link (instagram.com/name).',
        );
      }
      const url = handle ? instagramProfileUrl(handle) : data.url!;
      if (await this.prisma.businessCompetitorSource.findFirst({ where: { competitorId, url } })) {
        throw new BadRequestException('This link is already a source of the competitor');
      }
      row = await this.prisma.businessCompetitorSource.create({
        data: {
          competitorId,
          kind: handle ? 'INSTAGRAM' : data.site ? 'WEBSITE' : 'URL',
          url,
          title: data.title || (handle ? `Instagram @${handle}` : ''),
          createdById: user.id,
        },
      });
      row = await this.read(row);
    }
    this.log(user, competitor.businessId, 'source_add', { competitorId, sourceId: row.id, kind: row.kind });
    return competitorSourceOf(row);
  }

  async refresh(id: string, user: AuthUser): Promise<CompetitorSourceSummary> {
    const row = await this.findSource(id);
    if (row.kind === 'TEXT') throw new BadRequestException('A pasted text has nothing to refresh');
    if ((row.analysis as { provider?: string } | null)?.provider === 'MANUAL') {
      throw new BadRequestException(
        'The Instagram data was given by hand, so there is nothing to read again. Delete it and add the new data.',
      );
    }
    const competitor = await this.findCompetitor(row.competitorId);
    const updated = await this.read(row);
    this.log(user, competitor.businessId, 'source_refresh', { sourceId: id });
    return competitorSourceOf(updated);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.findSource(id);
    const competitor = await this.findCompetitor(row.competitorId);
    await this.prisma.businessCompetitorSource.delete({ where: { id } });
    this.log(user, competitor.businessId, 'source_delete', { sourceId: id });
  }

  /** Reads the source again and stores the result; a failure keeps the previous snapshot. */
  private async read(row: SourceRow): Promise<SourceRow> {
    const kind = row.kind === 'TEXT' ? 'URL' : row.kind;
    const out = await this.reader.snapshot(kind, row.url, row.title);
    let data: Prisma.BusinessCompetitorSourceUpdateInput;
    if (out.status === 'READY') {
      data = {
        content: out.content,
        title: out.title,
        status: 'READY',
        error: null,
        fetchedAt: new Date(),
        ...(out.analysis ? { analysis: asJson(out.analysis) } : {}),
      };
    } else {
      if (out.unexpected) {
        this.logger.warn(`competitor source ${row.id} (${row.url}) failed: ${out.error}`);
      }
      data = { status: 'FAILED', error: out.error };
    }
    return this.prisma.businessCompetitorSource.update({ where: { id: row.id }, data });
  }

  /**
   * The business's Instagram numbers next to each active competitor's latest readable Instagram
   * source (`compareBrands`): counted by code, never by the model.
   */
  async compare(businessId: string): Promise<CompareReport> {
    const [brand, competitors] = await Promise.all([
      this.businesses.instagramStats(businessId),
      this.prisma.businessCompetitor.findMany({
        where: { businessId, isActive: true },
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          sources: {
            where: { kind: 'INSTAGRAM', status: 'READY' },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: { analysis: true },
          },
        },
      }),
    ]);
    return compareBrands({
      brand,
      competitors: competitors.map((c) => ({
        id: c.id,
        name: c.name,
        stats: c.sources[0] ? statsOf(c.sources[0]) : null,
      })),
    });
  }
}
