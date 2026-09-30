import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AcceptSuggestionSchema,
  AddReferenceSchema,
  BuildBusinessSchema,
  BusinessListQuerySchema,
  BusinessSectionKey,
  CreateBlockedSourceSchema,
  CreateBusinessSchema,
  CreateFromReferencesSchema,
  DiscoverBusinessesSchema,
  isSourceBlocked,
  RemoveSourceSchema,
  SelectCandidateSchema,
  sourceBlockValue,
  SuggestBusinessSchema,
  SuggestionStatus,
  suggestScope,
  UpdateBusinessSchema,
  UpdateBusinessSectionSchema,
  UpdateReferenceSchema,
  type AcceptSuggestionInput,
  type AddReferenceInput,
  type BuildBusinessInput,
  type BusinessCandidate,
  type CreateBlockedSourceInput,
  type CreateBusinessInput,
  type CreateFromReferencesInput,
  type DiscoverBusinessesInput,
  type RemoveSourceInput,
  type ResearchScope,
  type SelectCandidateInput,
  type SourceBlockKind,
  type SuggestBusinessInput,
  type UpdateBusinessInput,
  type UpdateBusinessSectionInput,
  type UpdateReferenceInput,
  type WebSource,
} from '@contenter/shared';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { SamplesCoreModule } from '../samples/samples-core.module';
import { FileStorageService } from '../../infra/storage/file-storage.service';
import { BusinessNotesAssetsController } from './notes-assets.controller';
import {
  AssetUploadInterceptor,
  BusinessAssetsService,
  BusinessNotesService,
} from './notes-assets.service';
import { PodSpaceService } from './podspace.service';
import { ReferencesService } from './references.service';
import { writeSection } from './section-writer';

const RECENT_DISCOVERIES = 20;
const REVISIONS_LIMIT = 30;
const USER_REF = { select: { id: true, name: true } } as const;

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Businesses and their profile sections (docs/12-businesses.md). AI work — suggestions,
 * keyword discovery and research builds — is only ever queued here; runners persist results.
 */
@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly references: ReferencesService,
    private readonly assets: BusinessAssetsService,
    private readonly storage: FileStorageService,
  ) {}

  // ---------- businesses ----------

  async list(query: z.infer<typeof BusinessListQuerySchema>) {
    const where: Prisma.BusinessWhereInput = {
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
    const [items, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { topics: true, suggestions: { where: { status: 'PENDING' } } } },
          sections: { select: { content: true } },
        },
        ...paginate(query),
      }),
      this.prisma.business.count({ where }),
    ]);
    return toPage(
      items.map(({ sections, _count, ...b }) => ({
        ...b,
        filledSections: sections.filter((s) => s.content.trim()).length,
        pendingSuggestions: _count.suggestions,
        _count: { topics: _count.topics },
      })),
      total,
      query,
    );
  }

  /** Lightweight list for pickers (topic form). */
  options() {
    return this.prisma.business.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true },
    });
  }

  async get(id: string) {
    const b = await this.prisma.business.findUnique({
      where: { id },
      include: {
        sections: { include: { updatedBy: USER_REF } },
        topics: { select: { id: true, title: true, status: true }, orderBy: { updatedAt: 'desc' } },
        _count: { select: { topics: true, suggestions: { where: { status: 'PENDING' } } } },
      },
    });
    if (!b) throw new NotFoundException('Business not found');
    const { _count, ...rest } = b;
    return {
      ...rest,
      filledSections: b.sections.filter((s) => s.content.trim()).length,
      pendingSuggestions: _count.suggestions,
      _count: { topics: _count.topics },
    };
  }

  private async exists(id: string) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Business not found');
    return b;
  }

  async create(input: CreateBusinessInput, user: AuthUser) {
    const data = CreateBusinessSchema.parse(input);
    const b = await this.prisma.business.create({ data: { ...data, createdById: user.id } });
    this.audit.log({
      userId: user.id,
      action: 'business.create',
      entityType: 'Business',
      entityId: b.id,
    });
    return b;
  }

  async update(id: string, input: UpdateBusinessInput, user: AuthUser) {
    await this.exists(id);
    const b = await this.prisma.business.update({
      where: { id },
      data: UpdateBusinessSchema.parse(input),
    });
    this.audit.log({
      userId: user.id,
      action: 'business.update',
      entityType: 'Business',
      entityId: id,
      meta: input,
    });
    return b;
  }

  /** Linked topics keep existing; they are simply unlinked (onDelete: SetNull). */
  async remove(id: string, user: AuthUser) {
    await this.exists(id);
    const files = await this.assets.fileKeysOf(id);
    await this.prisma.business.delete({ where: { id } });
    await this.storage.remove(files);
    this.audit.log({
      userId: user.id,
      action: 'business.delete',
      entityType: 'Business',
      entityId: id,
    });
  }

  // ---------- sections ----------

  async updateSection(
    id: string,
    key: BusinessSectionKey,
    input: UpdateBusinessSectionInput,
    user: AuthUser,
  ) {
    await this.exists(id);
    const section = await this.prisma.$transaction((tx) =>
      writeSection(tx, {
        businessId: id,
        key,
        content: input.content,
        source: 'ADMIN',
        userId: user.id,
      }),
    );
    await this.touch(id);
    this.audit.log({
      userId: user.id,
      action: 'business.section_update',
      entityType: 'Business',
      entityId: id,
      meta: { key, chars: input.content.length },
    });
    return section;
  }

  async revisions(id: string, key: BusinessSectionKey) {
    const section = await this.prisma.businessSection.findUnique({
      where: { businessId_key: { businessId: id, key } },
    });
    if (!section) return [];
    return this.prisma.businessSectionRevision.findMany({
      where: { sectionId: section.id },
      orderBy: { createdAt: 'desc' },
      take: REVISIONS_LIMIT,
      include: { createdBy: USER_REF },
    });
  }

  /** Restores an old revision as the current content (the current text becomes a revision). */
  async restoreRevision(revisionId: string, user: AuthUser) {
    const rev = await this.prisma.businessSectionRevision.findUnique({
      where: { id: revisionId },
      include: { section: true },
    });
    if (!rev) throw new NotFoundException('Revision not found');
    const { businessId, key } = rev.section;
    const section = await this.prisma.$transaction((tx) =>
      writeSection(tx, { businessId, key, content: rev.content, source: 'ADMIN', userId: user.id }),
    );
    await this.touch(businessId);
    this.audit.log({
      userId: user.id,
      action: 'business.section_restore',
      entityType: 'Business',
      entityId: businessId,
      meta: { key, revisionId },
    });
    return section;
  }

  // ---------- AI suggestions ----------

  suggestions(id: string, status: (typeof SuggestionStatus)[number] = 'PENDING') {
    return this.prisma.businessSuggestion.findMany({
      where: { businessId: id, status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async suggest(id: string, input: SuggestBusinessInput, user: AuthUser) {
    const b = await this.prisma.business.findUnique({ where: { id }, include: { sections: true } });
    if (!b) throw new NotFoundException('Business not found');
    const data = SuggestBusinessSchema.parse(input);
    const filled = new Set(b.sections.filter((s) => s.content.trim()).map((s) => s.key));
    const keys = data.keys.length ? data.keys : BusinessSectionKey.filter((k) => !filled.has(k));
    if (!keys.length) {
      throw new BadRequestException(
        'Every section already has content; choose the sections to improve.',
      );
    }
    const scope = suggestScope(data);
    await this.assertReadable(id, scope, data.referenceIds, b.website);
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_SUGGEST',
      targetType: 'Business',
      targetId: id,
      input: { keys, instruction: data.instruction, scope, referenceIds: data.referenceIds },
      userId: user.id,
    });
    return { jobId: job.id, keys };
  }

  async acceptSuggestion(suggestionId: string, input: AcceptSuggestionInput, user: AuthUser) {
    const s = await this.pendingSuggestion(suggestionId);
    const content = input.content ?? s.content;
    // An admin edit makes the text the admin's own; accepted as is, it stays marked as AI text.
    const source = input.content !== undefined && input.content !== s.content ? 'ADMIN' : 'AI';
    const section = await this.prisma.$transaction(async (tx) => {
      await tx.businessSuggestion.update({
        where: { id: s.id },
        data: { status: 'ACCEPTED', decidedAt: new Date() },
      });
      return writeSection(tx, {
        businessId: s.businessId,
        key: s.key,
        content,
        source,
        userId: user.id,
      });
    });
    await this.touch(s.businessId);
    this.audit.log({
      userId: user.id,
      action: 'business.suggestion_accept',
      entityType: 'Business',
      entityId: s.businessId,
      meta: { suggestionId, key: s.key, edited: source === 'ADMIN' },
    });
    return section;
  }

  async dismissSuggestion(suggestionId: string, user: AuthUser) {
    const s = await this.pendingSuggestion(suggestionId);
    await this.prisma.businessSuggestion.update({
      where: { id: s.id },
      data: { status: 'DISMISSED', decidedAt: new Date() },
    });
    this.audit.log({
      userId: user.id,
      action: 'business.suggestion_dismiss',
      entityType: 'Business',
      entityId: s.businessId,
      meta: { suggestionId, key: s.key },
    });
    return { id: s.id };
  }

  private async pendingSuggestion(id: string) {
    const s = await this.prisma.businessSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Suggestion not found');
    if (s.status !== 'PENDING')
      throw new BadRequestException('This suggestion was already decided');
    return s;
  }

  // ---------- research build ----------

  async build(id: string, input: BuildBusinessInput, user: AuthUser) {
    const b = await this.exists(id);
    if (b.buildState === 'BUILDING') {
      throw new BadRequestException('A research build is already running for this business');
    }
    const data = BuildBusinessSchema.parse(input);
    await this.assertReadable(id, data.scope, data.referenceIds, b.website);
    return this.enqueueBuild(id, data, user);
  }

  /**
   * Rejects a job that is limited to the admin's references when none of them is readable
   * (a REFERENCE_SITES job can still search the business's own website).
   */
  private async assertReadable(
    id: string,
    scope: ResearchScope,
    referenceIds: string[] | undefined,
    website: string,
  ) {
    if (scope === 'NONE' || scope === 'WEB') return;
    if (await this.references.readyCount(id, referenceIds)) return;
    if (scope === 'REFERENCE_SITES' && website) return;
    throw new BadRequestException(
      'No readable reference: add a link, a Google Doc or a text first (or fix the failed ones).',
    );
  }

  private async enqueueBuild(
    id: string,
    input: { instruction: string; scope?: ResearchScope; referenceIds?: string[] },
    user: AuthUser,
  ) {
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_BUILD',
      targetType: 'Business',
      targetId: id,
      input: {
        instruction: input.instruction,
        scope: input.scope ?? 'WEB',
        referenceIds: input.referenceIds,
      },
      userId: user.id,
    });
    await this.prisma.business.update({
      where: { id },
      data: { buildState: 'BUILDING', buildError: null, lastJobId: job.id },
    });
    return { jobId: job.id, businessId: id };
  }

  // ---------- keyword discovery ----------

  discoveries() {
    return this.prisma.businessDiscovery.findMany({
      orderBy: { createdAt: 'desc' },
      take: RECENT_DISCOVERIES,
    });
  }

  async discovery(id: string) {
    const d = await this.prisma.businessDiscovery.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Discovery not found');
    return d;
  }

  async discover(input: DiscoverBusinessesInput, user: AuthUser) {
    const data = DiscoverBusinessesSchema.parse(input);
    const d = await this.prisma.businessDiscovery.create({
      data: { ...data, createdById: user.id },
    });
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_DISCOVER',
      targetType: 'BusinessDiscovery',
      targetId: d.id,
      input: { keyword: data.keyword },
      userId: user.id,
    });
    await this.prisma.businessDiscovery.update({ where: { id: d.id }, data: { jobId: job.id } });
    return { id: d.id, jobId: job.id };
  }

  /** The admin approves a candidate: create the business and research its full profile. */
  async selectCandidate(discoveryId: string, input: SelectCandidateInput, user: AuthUser) {
    const d = await this.discovery(discoveryId);
    if (d.status !== 'READY' && d.status !== 'USED') {
      throw new BadRequestException('The research has not finished yet');
    }
    const candidate = (d.candidates as unknown as BusinessCandidate[])[input.index];
    if (!candidate) throw new BadRequestException('Candidate not found');

    const business = await this.prisma.$transaction(async (tx) => {
      const b = await tx.business.create({
        data: {
          name: candidate.name.slice(0, 200),
          industry: candidate.industry.slice(0, 200),
          website: candidate.website,
          location: candidate.location.slice(0, 200),
          language: d.language,
          keyword: d.keyword,
          origin: 'RESEARCH',
          createdById: user.id,
          sources: d.sources ?? [],
        },
      });
      if (candidate.description.trim()) {
        await writeSection(tx, {
          businessId: b.id,
          key: 'OVERVIEW',
          content: candidate.description.trim(),
          source: 'AI',
          userId: null,
        });
      }
      await tx.businessDiscovery.update({
        where: { id: d.id },
        data: { status: 'USED', selectedIndex: input.index, businessId: b.id },
      });
      return b;
    });
    this.audit.log({
      userId: user.id,
      action: 'business.create_from_research',
      entityType: 'Business',
      entityId: business.id,
      meta: { discoveryId, index: input.index, keyword: d.keyword },
    });
    return this.enqueueBuild(business.id, { instruction: '' }, user);
  }

  // ---------- build from the admin's own sources ----------

  /**
   * Creates a business from references the admin supplies (links, Google Docs, a pasted text),
   * reads them, and — only when every one of them was readable — queues the build. Otherwise the
   * business is kept with its references so the admin can fix them and start the build.
   */
  async createFromReferences(input: CreateFromReferencesInput, user: AuthUser) {
    const data = CreateFromReferencesSchema.parse(input);
    const business = await this.prisma.business.create({
      data: {
        name: data.name,
        language: data.language,
        website: data.website,
        location: data.location,
        origin: 'SOURCES',
        createdById: user.id,
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'business.create_from_references',
      entityType: 'Business',
      entityId: business.id,
      meta: { links: data.urls.length, text: data.text.length, scope: data.scope },
    });

    const inputs: AddReferenceInput[] = [
      ...[...new Set(data.urls)].map((url) => ({ url })),
      ...(data.text ? [{ content: data.text, title: data.textTitle }] : []),
    ];
    const results = await Promise.allSettled(
      inputs.map((ref) => this.references.add(business.id, ref, user)),
    );
    const failed = results.filter(
      (r) => r.status === 'rejected' || r.value.references.some((ref) => ref.status !== 'READY'),
    ).length;
    if (failed) return { businessId: business.id, jobId: null, failed };

    const { jobId } = await this.enqueueBuild(
      business.id,
      { instruction: data.instruction, scope: data.scope },
      user,
    );
    return { businessId: business.id, jobId, failed: 0 };
  }

  // ---------- research sources & blocklist ----------

  /** Removes one research source from a business, optionally blacklisting it everywhere. */
  async removeSource(id: string, input: RemoveSourceInput, user: AuthUser) {
    const b = await this.exists(id);
    const data = RemoveSourceSchema.parse(input);
    const sources = b.sources as unknown as WebSource[];
    const kept = sources.filter((s) => s.url !== data.url);
    if (kept.length === sources.length) throw new NotFoundException('Source not found');
    const blocked = await this.blockFromRemoval(data, user);
    // A new rule already purged the source everywhere; otherwise remove just this one.
    if (!blocked) {
      await this.prisma.business.update({ where: { id }, data: { sources: asJson(kept) } });
    }
    this.audit.log({
      userId: user.id,
      action: 'business.source_remove',
      entityType: 'Business',
      entityId: id,
      meta: { url: data.url, block: data.block },
    });
    return { removed: data.url, blocked };
  }

  /** Same as removeSource, for the sources of a keyword discovery. */
  async removeDiscoverySource(discoveryId: string, input: RemoveSourceInput, user: AuthUser) {
    const d = await this.discovery(discoveryId);
    const data = RemoveSourceSchema.parse(input);
    const sources = d.sources as unknown as WebSource[];
    const kept = sources.filter((s) => s.url !== data.url);
    if (kept.length === sources.length) throw new NotFoundException('Source not found');
    const blocked = await this.blockFromRemoval(data, user);
    if (!blocked) {
      await this.prisma.businessDiscovery.update({
        where: { id: discoveryId },
        data: { sources: asJson(kept) },
      });
    }
    this.audit.log({
      userId: user.id,
      action: 'business.discovery_source_remove',
      entityType: 'BusinessDiscovery',
      entityId: discoveryId,
      meta: { url: data.url, block: data.block },
    });
    return { removed: data.url, blocked };
  }

  private async blockFromRemoval(data: z.infer<typeof RemoveSourceSchema>, user: AuthUser) {
    if (data.block === 'NONE') return null;
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only admins can block sources');
    return this.addBlock(data.block, data.url, '', user);
  }

  blocklist() {
    return this.prisma.blockedSource.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: USER_REF },
    });
  }

  block(input: CreateBlockedSourceInput, user: AuthUser) {
    const data = CreateBlockedSourceSchema.parse(input);
    return this.addBlock(data.kind, data.value, data.note, user);
  }

  async unblock(id: string, user: AuthUser) {
    const rule = await this.prisma.blockedSource.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Blocked source not found');
    await this.prisma.blockedSource.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'business.source_unblock',
      entityType: 'BlockedSource',
      entityId: id,
      meta: { kind: rule.kind, value: rule.value },
    });
  }

  /**
   * Adds (or updates) a blocklist rule and purges every stored source it matches — from all
   * businesses and discoveries, including candidates' source links. Future research excludes
   * it (AiExecutor.research).
   */
  private async addBlock(kind: SourceBlockKind, raw: string, note: string, user: AuthUser) {
    const value = sourceBlockValue(raw, kind);
    if (!value) throw new BadRequestException('Not a valid web address');
    const rule = await this.prisma.blockedSource.upsert({
      where: { kind_value: { kind, value } },
      create: { kind, value, note, createdById: user.id },
      update: note ? { note } : {},
      include: { createdBy: USER_REF },
    });
    const purged = await this.purgeBlocked([{ kind, value }]);
    this.audit.log({
      userId: user.id,
      action: 'business.source_block',
      entityType: 'BlockedSource',
      entityId: rule.id,
      meta: { kind, value, ...purged },
    });
    return rule;
  }

  private async purgeBlocked(rules: { kind: SourceBlockKind; value: string }[]) {
    const blocked = (url: string) => isSourceBlocked(url, rules);
    const clean = (sources: unknown) => {
      const list = (sources ?? []) as WebSource[];
      const kept = list.filter((s) => !blocked(s.url));
      return kept.length === list.length ? null : kept;
    };
    const [businesses, discoveries] = await Promise.all([
      this.prisma.business.findMany({ select: { id: true, sources: true } }),
      this.prisma.businessDiscovery.findMany({
        select: { id: true, sources: true, candidates: true },
      }),
    ]);
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    let businessesTouched = 0;
    for (const b of businesses) {
      const kept = clean(b.sources);
      if (!kept) continue;
      businessesTouched++;
      updates.push(
        this.prisma.business.update({ where: { id: b.id }, data: { sources: asJson(kept) } }),
      );
    }
    let discoveriesTouched = 0;
    for (const d of discoveries) {
      const kept = clean(d.sources);
      const candidates = (d.candidates ?? []) as unknown as BusinessCandidate[];
      let candidatesChanged = false;
      const cleanCandidates = candidates.map((c) => {
        const sourceUrls = (c.sourceUrls ?? []).filter((u) => !blocked(u));
        if (sourceUrls.length !== (c.sourceUrls ?? []).length) candidatesChanged = true;
        return { ...c, sourceUrls };
      });
      if (!kept && !candidatesChanged) continue;
      discoveriesTouched++;
      updates.push(
        this.prisma.businessDiscovery.update({
          where: { id: d.id },
          data: {
            ...(kept ? { sources: asJson(kept) } : {}),
            ...(candidatesChanged ? { candidates: asJson(cleanCandidates) } : {}),
          },
        }),
      );
    }
    if (updates.length) await this.prisma.$transaction(updates);
    return { businesses: businessesTouched, discoveries: discoveriesTouched };
  }

  private touch(id: string) {
    return this.prisma.business.update({ where: { id }, data: { updatedAt: new Date() } });
  }
}

const SectionKeyPipe = new ParseEnumPipe(Object.fromEntries(BusinessSectionKey.map((k) => [k, k])));

@Controller('businesses')
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly refs: ReferencesService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(BusinessListQuerySchema))
    query: z.infer<typeof BusinessListQuerySchema>,
  ) {
    return this.businesses.list(query);
  }

  @Get('options')
  options() {
    return this.businesses.options();
  }

  @Post()
  @Roles('ADMIN', 'EDITOR')
  create(
    @Body(new ZodValidationPipe(CreateBusinessSchema)) body: CreateBusinessInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.create(body, user);
  }

  @Post('from-references')
  @Roles('ADMIN', 'EDITOR')
  createFromReferences(
    @Body(new ZodValidationPipe(CreateFromReferencesSchema)) body: CreateFromReferencesInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.createFromReferences(body, user);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.businesses.get(id);
  }

  @Get(':id/references')
  references(@Param('id') id: string) {
    return this.refs.list(id);
  }

  @Post(':id/references')
  @Roles('ADMIN', 'EDITOR')
  async addReference(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddReferenceSchema)) body: AddReferenceInput,
    @CurrentUser() user: AuthUser,
  ) {
    await this.businesses.get(id);
    return this.refs.add(id, body, user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'EDITOR')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessSchema)) body: UpdateBusinessInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.update(id, body, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.businesses.remove(id, user);
  }

  @Put(':id/sections/:key')
  @Roles('ADMIN', 'EDITOR')
  updateSection(
    @Param('id') id: string,
    @Param('key', SectionKeyPipe) key: BusinessSectionKey,
    @Body(new ZodValidationPipe(UpdateBusinessSectionSchema)) body: UpdateBusinessSectionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.updateSection(id, key, body, user);
  }

  @Get(':id/sections/:key/revisions')
  revisions(@Param('id') id: string, @Param('key', SectionKeyPipe) key: BusinessSectionKey) {
    return this.businesses.revisions(id, key);
  }

  @Get(':id/suggestions')
  suggestions(
    @Param('id') id: string,
    @Query(
      'status',
      new ParseEnumPipe(Object.fromEntries(SuggestionStatus.map((s) => [s, s])), {
        optional: true,
      }),
    )
    status?: (typeof SuggestionStatus)[number],
  ) {
    return this.businesses.suggestions(id, status);
  }

  @Post(':id/suggest')
  @Roles('ADMIN', 'EDITOR')
  suggest(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SuggestBusinessSchema)) body: SuggestBusinessInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.suggest(id, body, user);
  }

  @Post(':id/sources/remove')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(200)
  removeSource(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RemoveSourceSchema)) body: RemoveSourceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.removeSource(id, body, user);
  }

  @Post(':id/build')
  @Roles('ADMIN', 'EDITOR')
  build(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BuildBusinessSchema)) body: BuildBusinessInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.build(id, body, user);
  }
}

@Controller()
export class BusinessItemsController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly refs: ReferencesService,
  ) {}

  @Get('business-references/:id')
  reference(@Param('id') id: string) {
    return this.refs.get(id);
  }

  @Patch('business-references/:id')
  @Roles('ADMIN', 'EDITOR')
  updateReference(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateReferenceSchema)) body: UpdateReferenceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.refs.update(id, body, user);
  }

  @Post('business-references/:id/refresh')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(200)
  refreshReference(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.refs.refresh(id, user);
  }

  @Delete('business-references/:id')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(204)
  removeReference(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.refs.remove(id, user);
  }

  @Post('business-revisions/:id/restore')
  @Roles('ADMIN', 'EDITOR')
  restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.businesses.restoreRevision(id, user);
  }

  @Post('business-suggestions/:id/accept')
  @Roles('ADMIN', 'EDITOR')
  accept(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AcceptSuggestionSchema)) body: AcceptSuggestionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.acceptSuggestion(id, body, user);
  }

  @Post('business-suggestions/:id/dismiss')
  @Roles('ADMIN', 'EDITOR')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.businesses.dismissSuggestion(id, user);
  }

  @Get('business-discoveries')
  discoveries() {
    return this.businesses.discoveries();
  }

  @Post('business-discoveries')
  @Roles('ADMIN', 'EDITOR')
  discover(
    @Body(new ZodValidationPipe(DiscoverBusinessesSchema)) body: DiscoverBusinessesInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.discover(body, user);
  }

  @Get('business-discoveries/:id')
  discovery(@Param('id') id: string) {
    return this.businesses.discovery(id);
  }

  @Post('business-discoveries/:id/select')
  @Roles('ADMIN', 'EDITOR')
  select(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SelectCandidateSchema)) body: SelectCandidateInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.selectCandidate(id, body, user);
  }

  @Post('business-discoveries/:id/sources/remove')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(200)
  removeDiscoverySource(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RemoveSourceSchema)) body: RemoveSourceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.removeDiscoverySource(id, body, user);
  }

  @Get('source-blocklist')
  blocklist() {
    return this.businesses.blocklist();
  }

  @Post('source-blocklist')
  @Roles('ADMIN')
  block(
    @Body(new ZodValidationPipe(CreateBlockedSourceSchema)) body: CreateBlockedSourceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.businesses.block(body, user);
  }

  @Delete('source-blocklist/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  unblock(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.businesses.unblock(id, user);
  }
}

@Module({
  imports: [SamplesCoreModule, GoogleDriveModule],
  controllers: [BusinessesController, BusinessItemsController, BusinessNotesAssetsController],
  providers: [
    BusinessesService,
    ReferencesService,
    PodSpaceService,
    BusinessNotesService,
    BusinessAssetsService,
    AssetUploadInterceptor,
  ],
  exports: [BusinessesService],
})
export class BusinessesModule {}
