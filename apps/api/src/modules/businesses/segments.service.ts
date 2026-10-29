import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessSegment as SegmentRow } from '@prisma/client';
import {
  BUSINESS_SEGMENT_LIMIT,
  CreateBusinessSegmentSchema,
  UpdateBusinessSegmentSchema,
  type BusinessSegment,
  type CreateBusinessSegmentInput,
  type UpdateBusinessSegmentInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type SegmentWithLinks = SegmentRow & { offerings?: { offeringId: string }[] };

export const segmentOf = (r: SegmentWithLinks): BusinessSegment => ({
  id: r.id,
  businessId: r.businessId,
  kind: r.kind,
  name: r.name,
  summary: r.summary,
  goals: r.goals,
  pains: r.pains,
  objections: r.objections,
  channels: r.channels,
  messageAngle: r.messageAngle,
  note: r.note,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
  offeringIds: (r.offerings ?? []).map((o) => o.offeringId).sort(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const WITH_LINKS = { offerings: { select: { offeringId: true } } } as const;
const ORDER = [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] as const;

/**
 * The audiences of a business (docs/73): market segments and personas typed by the admin and linked
 * to offerings (`OfferingsService.setSegments`). Phase 1 only stores them; no prompt, export or
 * check reads them yet. The internal note stays out of the audit log.
 */
@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private log(user: AuthUser, businessId: string, action: string, meta?: Record<string, unknown>) {
    this.audit.log({
      userId: user.id,
      action: `business.segment_${action}`,
      entityType: 'Business',
      entityId: businessId,
      meta,
    });
  }

  private async find(id: string) {
    const row = await this.prisma.businessSegment.findUnique({ where: { id }, include: WITH_LINKS });
    if (!row) throw new NotFoundException('Audience not found');
    return row;
  }

  private async assertNameFree(businessId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.businessSegment.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('An audience with this name already exists');
  }

  async list(businessId: string): Promise<BusinessSegment[]> {
    const rows = await this.prisma.businessSegment.findMany({
      where: { businessId },
      orderBy: [...ORDER],
      include: WITH_LINKS,
    });
    return rows.map(segmentOf);
  }

  async create(businessId: string, input: CreateBusinessSegmentInput, user: AuthUser) {
    const data = CreateBusinessSegmentSchema.parse(input);
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    if ((await this.prisma.businessSegment.count({ where: { businessId } })) >= BUSINESS_SEGMENT_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_SEGMENT_LIMIT} audiences`);
    }
    await this.assertNameFree(businessId, data.name);
    const row = await this.prisma.businessSegment.create({
      data: { businessId, ...data, updatedById: user.id },
      include: WITH_LINKS,
    });
    this.log(user, businessId, 'create', { segmentId: row.id, name: row.name });
    return segmentOf(row);
  }

  async update(id: string, input: UpdateBusinessSegmentInput, user: AuthUser) {
    const data = UpdateBusinessSegmentSchema.parse(input);
    const row = await this.find(id);
    if (data.name !== undefined && data.name.toLowerCase() !== row.name.toLowerCase()) {
      await this.assertNameFree(row.businessId, data.name, id);
    }
    const updated = await this.prisma.businessSegment.update({
      where: { id },
      data: { ...data, updatedById: user.id },
      include: WITH_LINKS,
    });
    this.log(user, row.businessId, 'update', { segmentId: id });
    return segmentOf(updated);
  }

  /** Deleting an audience also unlinks it from its offerings (cascade). */
  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    await this.prisma.businessSegment.delete({ where: { id } });
    this.log(user, row.businessId, 'delete', { segmentId: id });
  }
}
