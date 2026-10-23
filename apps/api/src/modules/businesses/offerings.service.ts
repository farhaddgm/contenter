import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessOffering as OfferingRow, Prisma } from '@prisma/client';
import {
  BUSINESS_OFFERING_LIMIT,
  CreateBusinessOfferingSchema,
  UpdateBusinessOfferingSchema,
  offeringProblems,
  priceText,
  type BusinessOffering,
  type CreateBusinessOfferingInput,
  type PriceCurrency,
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

export const offeringOf = (r: OfferingRow): BusinessOffering => ({
  id: r.id,
  businessId: r.businessId,
  name: r.name,
  aliases: r.aliases,
  kind: r.kind,
  status: r.status,
  push: r.push,
  summary: r.summary,
  features: r.features,
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
    const row = await this.prisma.businessOffering.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Offering not found');
    return row;
  }

  async list(businessId: string): Promise<BusinessOffering[]> {
    const rows = await this.prisma.businessOffering.findMany({
      where: { businessId },
      orderBy: [...ORDER],
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
    const row = await this.prisma.businessOffering.create({
      data: {
        businessId,
        name: data.name,
        aliases: data.aliases,
        kind: data.kind,
        status: data.status,
        push: data.push,
        summary: data.summary,
        features: data.features,
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
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.aliases !== undefined ? { aliases: data.aliases } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.push !== undefined ? { push: data.push } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.features !== undefined ? { features: data.features } : {}),
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
    });
    this.log(user, row.businessId, 'confirm', { offeringId: id });
    return offeringOf(updated);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
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
