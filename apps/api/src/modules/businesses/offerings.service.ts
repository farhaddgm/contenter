import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessOffering as OfferingRow, Prisma } from '@prisma/client';
import {
  BUSINESS_OFFERING_LIMIT,
  CreateBusinessOfferingSchema,
  normalizeMonths,
  offeringParentProblem,
  orderSegmentLinks,
  parseClaims,
  SetOfferingSegmentsSchema,
  UpdateBusinessOfferingSchema,
  offeringProblems,
  priceText,
  type BusinessOffering,
  type CreateBusinessOfferingInput,
  type PriceCurrency,
  type SetOfferingSegmentsInput,
  type UpdateBusinessOfferingInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';

/** `YYYY-MM-DD` / '' / null from the API → a DB date; undefined = not given. */
const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v ? new Date(`${v}T00:00:00.000Z`) : null;
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Rows are read with their audience links (docs/73), so every response carries them. */
const WITH_LINKS = { segmentLinks: { select: { segmentId: true, fit: true } } } as const;
type OfferingWithLinks = OfferingRow & { segmentLinks?: { segmentId: string; fit: number }[] };

export const offeringOf = (r: OfferingWithLinks): BusinessOffering => ({
  id: r.id,
  businessId: r.businessId,
  name: r.name,
  aliases: r.aliases,
  kind: r.kind,
  status: r.status,
  push: r.push,
  stock: r.stock,
  parentId: r.parentId,
  guardrails: r.guardrails,
  segments: orderSegmentLinks(r.segmentLinks ?? []),
  peakMonths: r.peakMonths,
  complementIds: r.complementIds,
  substituteIds: r.substituteIds,
  summary: r.summary,
  features: r.features,
  claims: parseClaims(r.claims),
  priceAmount: priceText(r.priceAmount),
  priceCurrency: (r.priceCurrency as PriceCurrency | null) ?? null,
  priceFrom: r.priceFrom,
  priceUnit: r.priceUnit,
  priceValidUntil: dayOf(r.priceValidUntil),
  availableFrom: dayOf(r.availableFrom),
  availableUntil: dayOf(r.availableUntil),
  url: r.url,
  note: r.note,
  source: r.source,
  verified: r.verified,
  isActive: r.isActive,
  evidence: r.evidence,
  sortOrder: r.sortOrder,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const ORDER = [{ push: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] as const;
const RUNNING = ['QUEUED', 'RUNNING', 'WAITING'] as const;

/**
 * The catalog of a business (docs/67-business-catalog.md): products, services, plans and bundles
 * with price, status and push level. Rows the admin types are active at once; rows the model
 * proposes (BUSINESS_OFFERINGS_EXTRACT) are saved inactive and unverified and reach no prompt, no
 * check and no export until the admin confirms them. Nothing here calls the model but `extract`,
 * which only queues the job.
 */
@Injectable()
export class OfferingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
  ) {}

  private log(user: AuthUser, businessId: string, action: string, meta?: Record<string, unknown>) {
    // the internal note and the quoted evidence stay out of the audit log
    this.audit.log({
      userId: user.id,
      action: `business.offering_${action}`,
      entityType: 'Business',
      entityId: businessId,
      meta,
    });
  }

  private async find(id: string) {
    const row = await this.prisma.businessOffering.findUnique({ where: { id }, include: WITH_LINKS });
    if (!row) throw new NotFoundException('Offering not found');
    return row;
  }

  async list(businessId: string): Promise<BusinessOffering[]> {
    const rows = await this.prisma.businessOffering.findMany({
      where: { businessId },
      orderBy: [...ORDER],
      include: WITH_LINKS,
    });
    return rows.map(offeringOf);
  }

  private async assertNameFree(businessId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.businessOffering.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('An offering with this name already exists');
  }

  /** Related offerings must be other offerings of the same business (a deleted one just drops out later). */
  private async assertRelated(businessId: string, ids: string[], selfId?: string) {
    if (!ids.length) return;
    if (selfId && ids.includes(selfId)) {
      throw new BadRequestException('An offering cannot be related to itself');
    }
    const found = await this.prisma.businessOffering.count({ where: { businessId, id: { in: ids } } });
    if (found !== new Set(ids).size) {
      throw new BadRequestException('Related offerings must belong to the same business');
    }
  }

  /**
   * The product tree stays a tree (docs/73): the parent is an offering of the same business, not the
   * row itself or one of its variants, and the whole branch fits in the allowed levels.
   */
  private async assertParent(businessId: string, parentId: string | null | undefined, selfId?: string) {
    if (!parentId) return;
    const rows = await this.prisma.businessOffering.findMany({
      where: { businessId },
      select: { id: true, parentId: true },
    });
    const problem = offeringParentProblem({ id: selfId, parentId, rows });
    if (problem) throw new BadRequestException(problem);
  }

  async create(businessId: string, input: CreateBusinessOfferingInput, user: AuthUser) {
    const data = CreateBusinessOfferingSchema.parse(input);
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    if ((await this.prisma.businessOffering.count({ where: { businessId } })) >= BUSINESS_OFFERING_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_OFFERING_LIMIT} offerings`);
    }
    await this.assertNameFree(businessId, data.name);
    await this.assertRelated(businessId, [...data.complementIds, ...data.substituteIds]);
    await this.assertParent(businessId, data.parentId);
    const row = await this.prisma.businessOffering.create({
      include: WITH_LINKS,
      data: {
        businessId,
        name: data.name,
        parentId: data.parentId || null,
        guardrails: data.guardrails,
        aliases: data.aliases,
        kind: data.kind,
        status: data.status,
        push: data.push,
        stock: data.stock,
        peakMonths: normalizeMonths(data.peakMonths),
        complementIds: data.complementIds,
        substituteIds: data.substituteIds,
        summary: data.summary,
        features: data.features,
        claims: data.claims,
        priceAmount: data.priceAmount,
        priceCurrency: data.priceAmount ? data.priceCurrency : null,
        priceFrom: data.priceAmount ? data.priceFrom : false,
        priceUnit: data.priceAmount ? data.priceUnit : '',
        priceValidUntil: data.priceAmount ? (toDate(data.priceValidUntil) ?? null) : null,
        availableFrom: toDate(data.availableFrom) ?? null,
        availableUntil: toDate(data.availableUntil) ?? null,
        url: data.url,
        note: data.note,
        sortOrder: data.sortOrder,
        source: 'ADMIN',
        verified: true,
        isActive: true,
        updatedById: user.id,
      },
    });
    this.log(user, businessId, 'create', { offeringId: row.id, name: row.name });
    return offeringOf(row);
  }

  async update(id: string, input: UpdateBusinessOfferingInput, user: AuthUser) {
    const data = UpdateBusinessOfferingSchema.parse(input);
    const row = await this.find(id);
    if (data.isActive === true && !row.verified) {
      throw new BadRequestException('Confirm this offering first');
    }
    if (data.name !== undefined && data.name.toLowerCase() !== row.name.toLowerCase()) {
      await this.assertNameFree(row.businessId, data.name, id);
    }
    await this.assertRelated(
      row.businessId,
      [...(data.complementIds ?? []), ...(data.substituteIds ?? [])],
      id,
    );
    if (data.parentId !== undefined) await this.assertParent(row.businessId, data.parentId, id);
    // the cross-field rules apply to the row as it will be, not only to the fields sent
    const price = data.priceAmount !== undefined ? data.priceAmount : priceText(row.priceAmount);
    // clearing the price clears its currency too, unless a currency is sent explicitly
    const currency =
      data.priceCurrency !== undefined
        ? data.priceCurrency
        : price === null && data.priceAmount !== undefined
          ? null
          : row.priceCurrency;
    const from = data.availableFrom !== undefined ? data.availableFrom || null : dayOf(row.availableFrom);
    const until =
      data.availableUntil !== undefined ? data.availableUntil || null : dayOf(row.availableUntil);
    const problem = offeringProblems({
      priceAmount: price,
      priceCurrency: currency,
      availableFrom: from,
      availableUntil: until,
    });
    if (problem) throw new BadRequestException(problem);

    const hasPrice = !!price;
    const updated = await this.prisma.businessOffering.update({
      where: { id },
      include: WITH_LINKS,
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        ...(data.guardrails !== undefined ? { guardrails: data.guardrails } : {}),
        ...(data.aliases !== undefined ? { aliases: data.aliases } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.push !== undefined ? { push: data.push } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.peakMonths !== undefined ? { peakMonths: normalizeMonths(data.peakMonths) } : {}),
        ...(data.complementIds !== undefined ? { complementIds: data.complementIds } : {}),
        ...(data.substituteIds !== undefined ? { substituteIds: data.substituteIds } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.features !== undefined ? { features: data.features } : {}),
        ...(data.claims !== undefined ? { claims: data.claims } : {}),
        priceAmount: hasPrice ? price : null,
        priceCurrency: hasPrice ? currency : null,
        priceFrom: hasPrice ? (data.priceFrom ?? row.priceFrom) : false,
        priceUnit: hasPrice ? (data.priceUnit ?? row.priceUnit) : '',
        priceValidUntil: hasPrice
          ? data.priceValidUntil !== undefined
            ? toDate(data.priceValidUntil)
            : row.priceValidUntil
          : null,
        ...(data.availableFrom !== undefined ? { availableFrom: toDate(data.availableFrom) } : {}),
        ...(data.availableUntil !== undefined ? { availableUntil: toDate(data.availableUntil) } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        updatedById: user.id,
      } satisfies Prisma.BusinessOfferingUncheckedUpdateInput,
    });
    this.log(user, row.businessId, 'update', { offeringId: id });
    return offeringOf(updated);
  }

  /** The admin read an AI-proposed row and accepts it: from now on it is used. */
  async confirm(id: string, user: AuthUser) {
    const row = await this.find(id);
    const updated = await this.prisma.businessOffering.update({
      where: { id },
      data: { verified: true, isActive: true, updatedById: user.id },
      include: WITH_LINKS,
    });
    this.log(user, row.businessId, 'confirm', { offeringId: id });
    return offeringOf(updated);
  }

  /**
   * Replaces the audiences of an offering (docs/73): each must be a segment of the same business,
   * at most `OFFERING_SEGMENTS_MAX`, linked once. An empty list clears them.
   */
  async setSegments(id: string, input: SetOfferingSegmentsInput, user: AuthUser) {
    const { links } = SetOfferingSegmentsSchema.parse(input);
    const row = await this.find(id);
    if (links.length) {
      const found = await this.prisma.businessSegment.count({
        where: { businessId: row.businessId, id: { in: links.map((l) => l.segmentId) } },
      });
      if (found !== links.length) {
        throw new BadRequestException('Audiences must belong to the same business');
      }
    }
    await this.prisma.$transaction([
      this.prisma.offeringSegment.deleteMany({ where: { offeringId: id } }),
      this.prisma.offeringSegment.createMany({
        data: links.map((l) => ({ offeringId: id, segmentId: l.segmentId, fit: l.fit })),
      }),
    ]);
    this.log(user, row.businessId, 'segments', { offeringId: id, count: links.length });
    return offeringOf(await this.find(id));
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    // a line with variants is not deleted from under them (the database refuses too)
    if (await this.prisma.businessOffering.count({ where: { parentId: id } })) {
      throw new BadRequestException('Move or delete its variants first');
    }
    await this.prisma.businessOffering.delete({ where: { id } });
    this.log(user, row.businessId, 'delete', { offeringId: id });
  }

  /**
   * Queues the model to propose rows from the profile and the references. It only reads what is
   * already stored; the runner checks every proposal against its quote before saving anything.
   */
  async extract(businessId: string, user: AuthUser) {
    const [services, facts, references, count, running] = await Promise.all([
      this.prisma.businessSection.count({ where: { businessId, key: 'SERVICES', content: { not: '' } } }),
      this.prisma.businessFact.count({ where: { businessId, isActive: true } }),
      this.prisma.businessReference.count({
        where: { businessId, status: 'READY', isActive: true, content: { not: '' } },
      }),
      this.prisma.businessOffering.count({ where: { businessId } }),
      this.prisma.aiJob.findFirst({
        where: {
          type: 'BUSINESS_OFFERINGS_EXTRACT',
          targetId: businessId,
          status: { in: [...RUNNING] },
        },
        select: { id: true },
      }),
    ]);
    if (running) throw new BadRequestException('A proposal is already being prepared');
    if (!services && !facts && !references) {
      throw new BadRequestException(
        'Write the products & services section, add key facts or add a reference first',
      );
    }
    if (count >= BUSINESS_OFFERING_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_OFFERING_LIMIT} offerings`);
    }
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_OFFERINGS_EXTRACT',
      targetType: 'Business',
      targetId: businessId,
      input: {},
      userId: user.id,
    });
    this.log(user, businessId, 'extract', { jobId: job.id });
    return { jobId: job.id };
  }
}
