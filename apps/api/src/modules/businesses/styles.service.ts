import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BusinessStyle as StyleRow, Prisma, StyleSource as SourceRow } from '@prisma/client';
import {
  AddStyleSourceSchema,
  BUSINESS_REFERENCE_MAX_CHARS,
  BUSINESS_STYLE_LIMIT,
  CreateBusinessStyleSchema,
  InstagramManualSchema,
  STYLE_SOURCE_LIMIT,
  UpdateBusinessStyleSchema,
  instagramProfileUrl,
  isInstagramUrl,
  parseInstagramHandle,
  type AddStyleSourceInput,
  type BusinessStyleDetail,
  type BusinessStyleSummary,
  type CreateBusinessStyleInput,
  type InstagramPost,
  type InstagramProfile,
  type ReferenceAnalysis,
  type StyleSourceSummary,
  type StyleTrait,
  type UpdateBusinessStyleInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';
import { FetchError, MediaFetcherService } from '../samples/media-fetcher.service';
import { isLoginWall, MIN_PAGE_TEXT } from './references.service';
import { analyzeInstagram, formatInstagramSnapshot } from './social/instagram-analysis';
import { InstagramService } from './social/instagram.service';
import { WebsiteCrawlerService } from './social/website-crawler.service';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/** What reading one source produced. */
interface Read {
  title: string;
  text: string;
  analysis?: ReferenceAnalysis;
}

type StyleWithCounts = StyleRow & { _count: { sources: number; topics: number } };

const summaryOf = (s: StyleWithCounts): BusinessStyleSummary => ({
  id: s.id,
  businessId: s.businessId,
  name: s.name,
  direction: s.direction,
  buildState: s.buildState,
  buildError: s.buildError,
  lastJobId: s.lastJobId,
  summary: s.summary,
  builtAt: s.builtAt?.toISOString() ?? null,
  reviewedAt: s.reviewedAt?.toISOString() ?? null,
  sourceCount: s._count.sources,
  topicCount: s._count.topics,
  updatedAt: s.updatedAt.toISOString(),
});

const sourceOf = ({ content, analysis, ...s }: SourceRow): StyleSourceSummary => ({
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

/**
 * Imitation styles of a business (docs/64-business-styles.md). Sources are read here, by code, into
 * text snapshots; the style itself is written by the BUSINESS_STYLE_BUILD job. Nothing in here calls
 * the model, and none of it touches the business's own references.
 */
@Injectable()
export class StylesService {
  private readonly logger = new Logger(StylesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly fetcher: MediaFetcherService,
    private readonly instagram: InstagramService,
    private readonly crawler: WebsiteCrawlerService,
  ) {}

  private log(user: AuthUser, businessId: string, action: string, meta?: Record<string, unknown>) {
    this.audit.log({
      userId: user.id,
      action: `business.style_${action}`,
      entityType: 'Business',
      entityId: businessId,
      meta,
    });
  }

  async list(businessId: string): Promise<BusinessStyleSummary[]> {
    const rows = await this.prisma.businessStyle.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { sources: true, topics: true } } },
    });
    return rows.map(summaryOf);
  }

  async get(id: string): Promise<BusinessStyleDetail> {
    const row = await this.prisma.businessStyle.findUnique({
      where: { id },
      include: {
        _count: { select: { sources: true, topics: true } },
        sources: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Style not found');
    return {
      ...summaryOf(row),
      traits: Array.isArray(row.traits) ? (row.traits as unknown as StyleTrait[]) : [],
      guide: row.guide,
      caveats: row.caveats,
      sources: row.sources.map(sourceOf),
    };
  }

  async create(businessId: string, input: CreateBusinessStyleInput, user: AuthUser) {
    const data = CreateBusinessStyleSchema.parse(input);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');
    const count = await this.prisma.businessStyle.count({ where: { businessId } });
    if (count >= BUSINESS_STYLE_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_STYLE_LIMIT} styles`);
    }
    await this.assertNameFree(businessId, data.name);
    const row = await this.prisma.businessStyle.create({
      data: { businessId, name: data.name, direction: data.direction, createdById: user.id },
    });
    this.log(user, businessId, 'create', { styleId: row.id });
    return this.get(row.id);
  }

  async update(id: string, input: UpdateBusinessStyleInput, user: AuthUser) {
    const data = UpdateBusinessStyleSchema.parse(input);
    const row = await this.find(id);
    if (data.name !== undefined && data.name.toLowerCase() !== row.name.toLowerCase()) {
      await this.assertNameFree(row.businessId, data.name);
    }
    const edited = data.summary !== undefined || data.guide !== undefined;
    if (edited && row.buildState !== 'READY') {
      throw new BadRequestException('Build the style first, then edit its guide');
    }
    await this.prisma.businessStyle.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.direction !== undefined ? { direction: data.direction } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.guide !== undefined ? { guide: data.guide } : {}),
        // the admin wrote or fixed it, so it counts as confirmed
        ...(edited ? { reviewedAt: new Date() } : {}),
      },
    });
    this.log(user, row.businessId, 'update', { styleId: id, edited });
    return this.get(id);
  }

  /** Confirms an AI-built style so projects can use it. */
  async review(id: string, user: AuthUser) {
    const row = await this.find(id);
    if (row.buildState !== 'READY' || !row.guide.trim()) {
      throw new BadRequestException('Only a built style can be confirmed');
    }
    await this.prisma.businessStyle.update({ where: { id }, data: { reviewedAt: new Date() } });
    this.log(user, row.businessId, 'review', { styleId: id });
    return this.get(id);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    await this.prisma.businessStyle.delete({ where: { id } });
    this.log(user, row.businessId, 'delete', { styleId: id });
  }

  async build(id: string, user: AuthUser) {
    const row = await this.find(id);
    if (row.buildState === 'BUILDING') {
      throw new BadRequestException('This style is already being built');
    }
    const ready = await this.prisma.styleSource.count({
      where: { styleId: id, status: 'READY', content: { not: '' } },
    });
    if (!ready) {
      throw new BadRequestException('Add at least one source that was read successfully');
    }
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_STYLE_BUILD',
      targetType: 'BusinessStyle',
      targetId: id,
      input: {},
      userId: user.id,
    });
    await this.prisma.businessStyle.update({
      where: { id },
      data: { buildState: 'BUILDING', buildError: null, lastJobId: job.id },
    });
    this.log(user, row.businessId, 'build', { styleId: id, sources: ready });
    return { id, jobId: job.id };
  }

  // ---------- sources ----------

  async addSource(styleId: string, input: AddStyleSourceInput, user: AuthUser) {
    const data = AddStyleSourceSchema.parse(input);
    const style = await this.find(styleId);
    const count = await this.prisma.styleSource.count({ where: { styleId } });
    if (count >= STYLE_SOURCE_LIMIT) {
      throw new BadRequestException(`A style can have at most ${STYLE_SOURCE_LIMIT} sources`);
    }

    let row: SourceRow;
    if (data.instagram) {
      row = await this.addManualInstagram(styleId, data.instagram, user);
    } else if (data.content) {
      row = await this.prisma.styleSource.create({
        data: {
          styleId,
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
      if (await this.prisma.styleSource.findFirst({ where: { styleId, url } })) {
        throw new BadRequestException('This link is already a source of the style');
      }
      row = await this.prisma.styleSource.create({
        data: {
          styleId,
          kind: handle ? 'INSTAGRAM' : data.site ? 'WEBSITE' : 'URL',
          url,
          title: data.title || (handle ? `Instagram @${handle}` : ''),
          createdById: user.id,
        },
      });
      await this.read(row);
    }
    this.log(user, style.businessId, 'source_add', { styleId, sourceId: row.id, kind: row.kind });
    return this.sourceById(row.id);
  }

  async refreshSource(id: string, user: AuthUser) {
    const row = await this.findSource(id);
    if (row.kind === 'TEXT') throw new BadRequestException('A pasted text has nothing to refresh');
    if ((row.analysis as { provider?: string } | null)?.provider === 'MANUAL') {
      throw new BadRequestException(
        'The Instagram data was given by hand, so there is nothing to read again. Delete it and add the new data.',
      );
    }
    await this.read(row);
    const style = await this.find(row.styleId);
    this.log(user, style.businessId, 'source_refresh', { sourceId: id });
    return this.sourceById(id);
  }

  async removeSource(id: string, user: AuthUser) {
    const row = await this.findSource(id);
    const style = await this.find(row.styleId);
    await this.prisma.styleSource.delete({ where: { id } });
    this.log(user, style.businessId, 'source_delete', { sourceId: id });
  }

  /** The text snapshot of a source, so the admin can see exactly what AI reads. */
  async sourceText(id: string) {
    const row = await this.findSource(id);
    return { ...sourceOf(row), content: row.content };
  }

  // ---------- internals ----------

  private async find(id: string) {
    const row = await this.prisma.businessStyle.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Style not found');
    return row;
  }

  private async findSource(id: string) {
    const row = await this.prisma.styleSource.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Source not found');
    return row;
  }

  private async sourceById(id: string) {
    return sourceOf(await this.findSource(id));
  }

  private async assertNameFree(businessId: string, name: string) {
    const taken = await this.prisma.businessStyle.findFirst({
      where: { businessId, name: { equals: name, mode: 'insensitive' } },
    });
    if (taken) throw new BadRequestException('A style with this name already exists');
  }

  /** Reads a source into its text snapshot. A failed read is stored on the row, never thrown. */
  private async read(row: SourceRow): Promise<void> {
    let data: Prisma.StyleSourceUpdateInput;
    try {
      const out =
        row.kind === 'INSTAGRAM'
          ? await this.readInstagram(row)
          : row.kind === 'WEBSITE'
            ? await this.readWebsite(row)
            : await this.readPage(row.url);
      const text = out.text.trim().slice(0, BUSINESS_REFERENCE_MAX_CHARS);
      if (!text) throw new FetchError('No readable text was found. Paste the text instead.');
      data = {
        content: text,
        title: row.title || out.title.slice(0, 300),
        status: 'READY',
        error: null,
        fetchedAt: new Date(),
        ...(out.analysis ? { analysis: asJson(out.analysis) } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof FetchError)) {
        this.logger.warn(`style source ${row.id} (${row.url}) failed: ${message}`);
      }
      // keep the previous snapshot: a failed refresh must not erase readable text
      data = { status: 'FAILED', error: message.slice(0, 1000) };
    }
    await this.prisma.styleSource.update({ where: { id: row.id }, data });
  }

  /** Public data of a Business/Creator account through the official API (never instagram.com). */
  private async readInstagram(row: SourceRow): Promise<Read> {
    const handle = parseInstagramHandle(row.url);
    if (!handle) throw new FetchError('This source does not point to an Instagram account');
    const { profile, posts } = await this.instagram.fetchAccount(handle);
    const analysis = analyzeInstagram('GRAPH', profile, posts);
    return {
      title: `Instagram @${profile.username}`,
      text: formatInstagramSnapshot({ provider: 'GRAPH', profile, posts, analysis, readAt: new Date() }),
      analysis,
    };
  }

  private async readWebsite(row: SourceRow): Promise<Read> {
    const out = await this.crawler.read(row.url);
    return { title: out.title, text: out.text, analysis: out.analysis };
  }

  private async readPage(url: string): Promise<Read> {
    const { media } = await this.fetcher.fetch(url);
    if (isLoginWall(url, media.finalUrl ?? url)) {
      throw new FetchError(
        'This page requires signing in, so its content cannot be read. Paste the text instead.',
      );
    }
    const text = (media.text ?? media.description ?? '').trim();
    if (text.length < MIN_PAGE_TEXT) {
      throw new FetchError(
        `Only ${text.length} characters of readable text were found — the page probably needs a login or JavaScript. Paste the text instead.`,
      );
    }
    return { title: media.title ?? '', text };
  }

  /** Bio, counts and captions the admin typed or took from the account's data export. */
  private async addManualInstagram(
    styleId: string,
    input: NonNullable<AddStyleSourceInput['instagram']>,
    user: AuthUser,
  ): Promise<SourceRow> {
    const manual = InstagramManualSchema.parse(input);
    const handle = parseInstagramHandle(manual.handle) ?? '';
    const url = handle ? instagramProfileUrl(handle) : '';
    if (url && (await this.prisma.styleSource.findFirst({ where: { styleId, url } }))) {
      throw new BadRequestException(
        'This Instagram account is already a source. Delete it first to replace it with new data.',
      );
    }
    const profile: InstagramProfile = {
      username: handle,
      name: manual.name,
      biography: manual.biography,
      website: manual.website,
      followers: manual.followers ?? null,
      following: manual.following ?? null,
      mediaCount: manual.mediaCount ?? null,
    };
    const posts: InstagramPost[] = manual.posts
      .filter((p) => p.caption)
      .map((p) => ({
        caption: p.caption,
        takenAt:
          p.takenAt && !Number.isNaN(Date.parse(p.takenAt))
            ? new Date(p.takenAt).toISOString()
            : null,
        mediaType: p.mediaType ?? 'UNKNOWN',
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        permalink: p.permalink ?? '',
      }));
    const analysis = analyzeInstagram('MANUAL', profile, posts);
    return this.prisma.styleSource.create({
      data: {
        styleId,
        kind: 'INSTAGRAM',
        url,
        title: handle ? `Instagram @${handle}` : 'Instagram (given by hand)',
        content: formatInstagramSnapshot({
          provider: 'MANUAL',
          profile,
          posts,
          analysis,
          readAt: new Date(),
        }).slice(0, BUSINESS_REFERENCE_MAX_CHARS),
        analysis: asJson(analysis),
        status: 'READY',
        fetchedAt: new Date(),
        createdById: user.id,
      },
    });
  }
}
