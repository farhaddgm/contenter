import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  offeringQualityRule,
  type DocooBusinessListQuery,
  type InstagramStats,
  type QualityOfferingRule,
  type StyleTrait,
} from '@contenter/shared';
import { paginate } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** The fields of a catalog row that the prompt and the quality check read (docs/67). */
export const OFFERING_CORE_SELECT = {
  id: true,
  stock: true,
  peakMonths: true,
  complementIds: true,
  substituteIds: true,
  name: true,
  aliases: true,
  kind: true,
  status: true,
  push: true,
  summary: true,
  features: true,
  claims: true,
  priceAmount: true,
  priceCurrency: true,
  priceFrom: true,
  priceUnit: true,
  priceValidUntil: true,
  availableFrom: true,
  availableUntil: true,
} satisfies Prisma.BusinessOfferingSelect;

/** Catalog rows a model and the quality gate may use: switched on and confirmed by a person. */
const USABLE_OFFERING = { isActive: true, verified: true } as const;
/** Push level first, then the admin's order; a total order, so the prompt and export are stable. */
const OFFERING_ORDER = [
  { push: 'desc' },
  { sortOrder: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.BusinessOfferingOrderByWithRelationInput[];

/**
 * What `formatBusiness` needs: the sections (with review state), active key facts and
 * terminology, the catalog and the usable brand assets (newest first).
 */
export const BUSINESS_PROMPT_INCLUDE = {
  sections: { select: { key: true, content: true, source: true, reviewedAt: true } },
  facts: {
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    select: { label: true, value: true, category: true, verified: true, validUntil: true },
  },
  offerings: { where: USABLE_OFFERING, orderBy: OFFERING_ORDER, select: OFFERING_CORE_SELECT },
  terms: {
    where: { isActive: true },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    select: { term: true, kind: true, alternatives: true, note: true },
  },
  assets: {
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { kind: true, title: true, description: true, analysis: true },
  },
} satisfies Prisma.BusinessInclude;

/** What the Docoo / Bee Researcher export reads from the database (one query). */
export const EXPORT_INCLUDE = {
  sections: true,
  facts: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
  terms: { orderBy: { createdAt: 'asc' } },
  offerings: { orderBy: OFFERING_ORDER },
  notes: { orderBy: { createdAt: 'desc' }, take: 50 },
  references: { orderBy: { createdAt: 'asc' } },
  assets: { orderBy: { createdAt: 'desc' }, take: 200 },
  audits: { where: { status: 'READY' }, orderBy: { createdAt: 'desc' }, take: 1 },
  topics: { select: { id: true, title: true, status: true }, orderBy: { updatedAt: 'desc' } },
  _count: { select: { suggestions: { where: { status: 'PENDING' } } } },
} satisfies Prisma.BusinessInclude;

export type ExportRow = Prisma.BusinessGetPayload<{ include: typeof EXPORT_INCLUDE }>;

const SUMMARY_INCLUDE = {
  _count: { select: { topics: true } },
  sections: { select: { content: true } },
} satisfies Prisma.BusinessInclude;

export interface StylePromptRow {
  name: string;
  summary: string;
  guide: string;
  traits: StyleTrait[];
}

/** Reference documents a model may read: finished, switched on, with text. */
const READABLE_REFERENCE = { status: 'READY', isActive: true, content: { not: '' } } as const;

/**
 * The one door to a business's identity for the rest of the app (docs/63-business-boundary.md).
 *
 * Read-only on purpose. Anything outside `modules/businesses` that needs to know something about a
 * business — its profile, references, facts, notes, the export — asks here instead of querying the
 * `Business*` tables; the ESLint rule `no-restricted-syntax` in `apps/api/eslint.config.mjs`
 * enforces it. Writing stays in `modules/businesses` and the business AI runners.
 */
@Injectable()
export class BusinessApi {
  constructor(private readonly prisma: PrismaService) {}

  /** `id → name` for the ids that exist (a deleted business is simply missing). */
  async names(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.business.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((b) => [b.id, b.name]));
  }

  /** The business with everything the `business` prompt variable is built from, or null. */
  promptProfile(businessId: string) {
    return this.prisma.business.findUnique({
      where: { id: businessId },
      include: BUSINESS_PROMPT_INCLUDE,
    });
  }

  /** Readable reference documents (docs/19): oldest first by default, `recent` = last changed first. */
  readableReferences(businessId: string, opts: { order?: 'oldest' | 'recent'; take?: number } = {}) {
    const recent = opts.order === 'recent';
    return this.prisma.businessReference.findMany({
      where: { businessId, ...READABLE_REFERENCE },
      orderBy: recent ? { updatedAt: 'desc' } : { createdAt: 'asc' },
      ...(opts.take === undefined ? {} : { take: opts.take }),
      select: { id: true, title: true, url: true, content: true },
    });
  }

  /** Active notes of the business, newest first (`exceptId`: the note being applied now). */
  standingNotes(businessId: string, exceptId?: string) {
    return this.prisma.businessNote.findMany({
      where: {
        businessId,
        isActive: true,
        status: { not: 'FAILED' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { text: true },
    });
  }

  /** Active key facts, for the stale-content check. */
  activeFacts(businessId: string) {
    return this.prisma.businessFact.findMany({
      where: { businessId, isActive: true },
      select: { label: true, value: true, validUntil: true },
    });
  }

  /** Catalog rows the quality gate and the stale check compare texts with (docs/67). */
  async offeringsForQuality(businessId: string, now = new Date()): Promise<QualityOfferingRule[]> {
    const rows = await this.prisma.businessOffering.findMany({
      where: { businessId, ...USABLE_OFFERING },
      select: OFFERING_CORE_SELECT,
    });
    return rows.map((r) => offeringQualityRule(r, now));
  }

  /** The business's latest Instagram statistics (computed in code, docs/28), or null. */
  async instagramStats(businessId: string): Promise<InstagramStats | null> {
    const ref = await this.prisma.businessReference.findFirst({
      where: { businessId, kind: 'INSTAGRAM', status: 'READY', isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { analysis: true },
    });
    const a = ref?.analysis as { type?: string; stats?: InstagramStats } | null;
    return a?.type === 'INSTAGRAM' && a.stats ? a.stats : null;
  }

  /** How much business material a topic can lean on when its profile is built (docs/16, docs/19). */
  async materialForTopic(topicId: string): Promise<{ filledSections: number; readableReferences: number }> {
    const business = { topics: { some: { id: topicId } } };
    const [filledSections, readableReferences] = await Promise.all([
      this.prisma.businessSection.count({ where: { business, content: { not: '' } } }),
      this.prisma.businessReference.count({ where: { business, ...READABLE_REFERENCE } }),
    ]);
    return { filledSections, readableReferences };
  }

  /**
   * The style a project chose, only when it belongs to the business, is built and confirmed by
   * the admin (docs/64). Anything else is null: an unconfirmed style never reaches a draft.
   */
  async styleForPrompt(businessId: string, styleId: string): Promise<StylePromptRow | null> {
    const row = await this.prisma.businessStyle.findFirst({
      where: { id: styleId, businessId, buildState: 'READY', reviewedAt: { not: null } },
      select: { name: true, summary: true, guide: true, traits: true },
    });
    if (!row) return null;
    return {
      name: row.name,
      summary: row.summary,
      guide: row.guide,
      traits: Array.isArray(row.traits) ? (row.traits as unknown as StyleTrait[]) : [],
    };
  }

  // ---- integrations (Docoo, Bee Researcher): read-only, scoped by an optional allowlist ----

  /** Number of businesses; `allowedIds` undefined = all. */
  countAll(allowedIds?: string[]) {
    return this.prisma.business.count(
      allowedIds === undefined ? undefined : { where: { id: { in: allowedIds } } },
    );
  }

  /** One page of light summary rows, ordered by name. */
  async listSummaries(query: DocooBusinessListQuery, allowedIds?: string[]) {
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
        include: SUMMARY_INCLUDE,
        ...paginate(query),
      }),
      this.prisma.business.count({ where }),
    ]);
    return { rows, total };
  }

  /** The business with all it exports, or null. */
  findForExport(businessId: string) {
    return this.prisma.business.findUnique({ where: { id: businessId }, include: EXPORT_INCLUDE });
  }
}

/** Global so any module can ask for a business without importing `BusinessesModule`. */
@Global()
@Module({ providers: [BusinessApi], exports: [BusinessApi] })
export class BusinessApiModule {}
