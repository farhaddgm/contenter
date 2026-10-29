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
import { AiJobsService } from '../ai/ai-jobs.service';
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
  source: r.source,
  verified: r.verified,
  evidence: r.evidence,
  offeringIds: (r.offerings ?? []).map((o) => o.offeringId).sort(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const WITH_LINKS = { offerings: { select: { offeringId: true } } } as const;
const ORDER = [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] as const;
const RUNNING = ['QUEUED', 'RUNNING', 'WAITING'] as const;

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
    private readonly jobs: AiJobsService,
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
    // an audience the model proposed is switched on only by confirming it
    if (data.isActive === true && !row.verified) throw new BadRequestException('Confirm this audience first');
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

  /** The admin read an AI-proposed audience and accepts it: from now on it is used. */
  async confirm(id: string, user: AuthUser) {
    const row = await this.find(id);
    const updated = await this.prisma.businessSegment.update({
      where: { id },
      data: { verified: true, isActive: true, updatedById: user.id },
      include: WITH_LINKS,
    });
    this.log(user, row.businessId, 'confirm', { segmentId: id });
    return segmentOf(updated);
  }

  /**
   * Queues the model to propose audiences from the profile and the references (docs/73). It only
   * reads what is already stored; the runner checks every proposal against its quote before saving.
   */
  async propose(businessId: string, user: AuthUser) {
    const [material, facts, references, count, running] = await Promise.all([
      this.prisma.businessSection.count({
        where: { businessId, key: { in: ['TARGET_MARKET', 'PERSONAS'] }, content: { not: '' } },
      }),
      this.prisma.businessFact.count({ where: { businessId, isActive: true } }),
      this.prisma.businessReference.count({
        where: { businessId, status: 'READY', isActive: true, content: { not: '' } },
      }),
      this.prisma.businessSegment.count({ where: { businessId } }),
      this.prisma.aiJob.findFirst({
        where: { type: 'BUSINESS_SEGMENTS_PROPOSE', targetId: businessId, status: { in: [...RUNNING] } },
        select: { id: true },
      }),
    ]);
    if (running) throw new BadRequestException('A proposal is already being prepared');
    if (!material && !facts && !references) {
      throw new BadRequestException('Write the target market or personas section, add key facts or add a reference first');
    }
    if (count >= BUSINESS_SEGMENT_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_SEGMENT_LIMIT} audiences`);
    }
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_SEGMENTS_PROPOSE',
      targetType: 'Business',
      targetId: businessId,
      input: {},
      userId: user.id,
    });
    this.log(user, businessId, 'propose', { jobId: job.id });
    return { jobId: job.id };
  }

  /** Deleting an audience also unlinks it from its offerings (cascade). */
  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    await this.prisma.businessSegment.delete({ where: { id } });
    this.log(user, row.businessId, 'delete', { segmentId: id });
  }
}
