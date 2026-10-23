import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessCompetitor as CompetitorRow } from '@prisma/client';
import {
  BUSINESS_COMPETITOR_LIMIT,
  CreateBusinessCompetitorSchema,
  UpdateBusinessCompetitorSchema,
  competitorsSectionBlock,
  mergeCompetitorsBlock,
  type BusinessCompetitor,
  type CreateBusinessCompetitorInput,
  type UpdateBusinessCompetitorInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { writeSection } from './section-writer';

export const competitorOf = (r: CompetitorRow): BusinessCompetitor => ({
  id: r.id,
  businessId: r.businessId,
  name: r.name,
  kind: r.kind,
  website: r.website,
  instagram: r.instagram,
  positioning: r.positioning,
  pricing: r.pricing,
  strengths: r.strengths,
  weaknesses: r.weaknesses,
  difference: r.difference,
  note: r.note,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const ORDER = [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] as const;

/**
 * Competitor cards (docs/70, phase 1). The cards are typed by the admin and never reach a prompt,
 * an export or the similarity check on their own; `addToProfile` is the one way their text gets
 * into the COMPETITORS section, written through `writeSection` (so the section lock applies).
 */
@Injectable()
export class CompetitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private log(user: AuthUser, businessId: string, action: string, meta?: Record<string, unknown>) {
    // the internal note stays out of the audit log
    this.audit.log({
      userId: user.id,
      action: `business.competitor_${action}`,
      entityType: 'Business',
      entityId: businessId,
      meta,
    });
  }

  private async find(id: string) {
    const row = await this.prisma.businessCompetitor.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Competitor not found');
    return row;
  }

  private async assertNameFree(businessId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.businessCompetitor.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('A competitor with this name already exists');
  }

  async list(businessId: string): Promise<BusinessCompetitor[]> {
    const rows = await this.prisma.businessCompetitor.findMany({
      where: { businessId },
      orderBy: [...ORDER],
    });
    return rows.map(competitorOf);
  }

  async create(businessId: string, input: CreateBusinessCompetitorInput, user: AuthUser) {
    const data = CreateBusinessCompetitorSchema.parse(input);
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    if ((await this.prisma.businessCompetitor.count({ where: { businessId } })) >= BUSINESS_COMPETITOR_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_COMPETITOR_LIMIT} competitors`);
    }
    await this.assertNameFree(businessId, data.name);
    const row = await this.prisma.businessCompetitor.create({
      data: { businessId, ...data, updatedById: user.id },
    });
    this.log(user, businessId, 'create', { competitorId: row.id, name: row.name });
    return competitorOf(row);
  }

  async update(id: string, input: UpdateBusinessCompetitorInput, user: AuthUser) {
    const data = UpdateBusinessCompetitorSchema.parse(input);
    const row = await this.find(id);
    if (data.name !== undefined && data.name.toLowerCase() !== row.name.toLowerCase()) {
      await this.assertNameFree(row.businessId, data.name, id);
    }
    const updated = await this.prisma.businessCompetitor.update({
      where: { id },
      data: { ...data, updatedById: user.id },
    });
    this.log(user, row.businessId, 'update', { competitorId: id });
    return competitorOf(updated);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    await this.prisma.businessCompetitor.delete({ where: { id } });
    this.log(user, row.businessId, 'delete', { competitorId: id });
  }

  /**
   * Writes the active cards into the COMPETITORS section: replaces the block this method wrote
   * before, keeps the admin's own text around it. A locked section answers 403 (`writeSection`).
   */
  async addToProfile(businessId: string, user: AuthUser) {
    const rows = await this.prisma.businessCompetitor.findMany({
      where: { businessId, isActive: true },
      orderBy: [...ORDER],
    });
    const block = competitorsSectionBlock(rows);
    const section = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.businessSection.findUnique({
        where: { businessId_key: { businessId, key: 'COMPETITORS' } },
        select: { content: true },
      });
      return writeSection(tx, {
        businessId,
        key: 'COMPETITORS',
        content: mergeCompetitorsBlock(existing?.content ?? '', block),
        source: 'ADMIN',
        userId: user.id,
        actor: { kind: 'USER', role: user.role },
      });
    });
    this.log(user, businessId, 'to_profile', { count: rows.length });
    return { key: section.key, length: section.content.length };
  }
}
