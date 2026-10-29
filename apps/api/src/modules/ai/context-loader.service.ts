import { Injectable } from '@nestjs/common';
import {
  DEFAULT_GOLDEN_SETTINGS,
  effectiveFocus,
  pickGoldenExamples,
  type ContentFormat,
  type Platform,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessApi } from '../businesses/business-api';
import { SettingsService } from '../settings/settings.module';
import { MAX_DOCUMENTS_TEXT, type DocumentForPrompt, type ExampleForPrompt } from './context';
import { SemanticRetriever } from './semantic/semantic.service';

/** What a draft is being written for, so the closest golden examples are chosen. */
export interface ExampleTarget {
  platform: Platform;
  format: ContentFormat;
  /** The content itself and its source: never an example for themselves. */
  excludeIds?: string[];
}

/**
 * Loads the shared context every generative task needs: the linked business, principles, brand
 * documents and the active profile.
 */
@Injectable()
export class ContextLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessApi,
    private readonly settings?: SettingsService,
    private readonly semantic?: SemanticRetriever,
  ) {}

  /** Active topic principles followed by active global principles. */
  principles(topicId: string) {
    return this.prisma.principle.findMany({
      where: { isActive: true, OR: [{ topicId }, { topicId: null }] },
      orderBy: [
        { topicId: { sort: 'desc', nulls: 'last' } },
        { order: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /** Active brand documents of the topic, oldest first (stable prompt prefix). */
  brandDocs(topicId: string) {
    return this.prisma.brandDocument.findMany({
      where: { topicId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, title: true, content: true },
    });
  }

  /**
   * The business linked to the topic with its sections (the whole profile), or null. A topic
   * without analyzed sample contents (skipped, or none yet) also gets the business's reference
   * documents, so content rests on documents instead of samples (docs/19-optional-samples.md).
   * When those documents are too big to send whole, the passages closest in meaning to the topic
   * (and to `extraQuery`, e.g. the brief) are chosen instead of an equal slice of each
   * (docs/60-reliability-and-cost.md). `opts.semantic: false` skips that choice (no indexing, no
   * embeddings call) and gives the equal slices, for read-only previews.
   */
  async business(
    topicId: string,
    target?: ExampleTarget,
    opts: {
      semantic?: boolean;
      /**
       * Add `[FOCUS]` (docs/73): `true` = the project's offering and audience; `{ contentId }` = that
       * content's own, falling back to the project's. Jobs that do not write for one offering or
       * audience (profile building, learning from edits) leave it off, so their prompt is unchanged.
       */
      focus?: true | { contentId: string };
    } = {},
  ) {
    const topic = await this.prisma.topic.findUniqueOrThrow({
      where: { id: topicId },
      select: {
        businessId: true,
        samplesSkippedAt: true,
        styleId: true,
        offeringId: true,
        segmentId: true,
        title: true,
        description: true,
        audience: true,
      },
    });
    if (!topic.businessId) return null;
    const business = await this.businessById(topic.businessId);
    if (!business) return null;
    const analyzed = topic.samplesSkippedAt
      ? 0
      : await this.prisma.sampleContent.count({ where: { topicId, analysisStatus: 'DONE' } });
    // big reference documents are cut to the passages closest to the topic (docs/60)
    let documents: DocumentForPrompt[] = [];
    if (analyzed === 0) {
      const all = await this.documents(topic.businessId);
      const query = [topic.title, topic.description, topic.audience].filter(Boolean).join('\n');
      // `semantic: false` (the preview, docs/66) must not index or call the embeddings vendor
      documents =
        (opts.semantic === false ? null : await this.semantic?.select(all, query, MAX_DOCUMENTS_TEXT)) ??
        all;
    }
    const focus = opts.focus ? await this.focus(topic.businessId, topic, opts.focus) : null;
    return {
      ...business,
      documents,
      ...(focus ? { focus } : {}),
      // only a draft being written gets examples; ideas, profiles and the like do not
      ...(target
        ? {
            examples: await this.goldenExamples(topic.businessId, target),
            style: topic.styleId
              ? await this.businesses.styleForPrompt(topic.businessId, topic.styleId)
              : null,
          }
        : {}),
    };
  }

  /** The offering and audience a job is about: the content's own, else the project's (docs/73). */
  private async focus(
    businessId: string,
    topic: { offeringId: string | null; segmentId: string | null },
    ref: true | { contentId: string },
  ) {
    const content =
      ref === true
        ? null
        : await this.prisma.content.findUnique({
            where: { id: ref.contentId },
            select: { offeringId: true, segmentId: true },
          });
    return this.businesses.focusForPrompt(businessId, effectiveFocus(content, topic));
  }

  /**
   * Up to K golden examples of the business for a draft (docs/49-golden-examples.md): approved or
   * published, with a current text, the closest platform/format first, within the admin's limits.
   * A marked content that was edited, un-approved or deleted is never here.
   */
  async goldenExamples(businessId: string, target: ExampleTarget): Promise<ExampleForPrompt[]> {
    const { maxExamples, maxChars } = (await this.settings?.getGolden()) ?? DEFAULT_GOLDEN_SETTINGS;
    if (maxExamples <= 0) return [];
    const rows = await this.prisma.content.findMany({
      where: {
        goldenAt: { not: null },
        topic: { businessId },
        currentVersionId: { not: null },
        OR: [{ status: 'APPROVED' }, { publishedAt: { not: null } }],
        ...(target.excludeIds?.length ? { id: { notIn: target.excludeIds } } : {}),
      },
      orderBy: { goldenAt: 'desc' },
      take: 30,
      select: {
        id: true,
        platform: true,
        format: true,
        goldenAt: true,
        topic: { select: { platform: true } },
        currentVersion: { select: { title: true, body: true, cta: true } },
      },
    });
    const usable = rows.flatMap((r) =>
      r.currentVersion && r.goldenAt
        ? [{ ...r, platform: r.platform ?? r.topic.platform, goldenAt: r.goldenAt, v: r.currentVersion }]
        : [],
    );
    return pickGoldenExamples(usable, target, maxExamples).map((r) => {
      const text = `${r.v.title}\n${r.v.body}\n${r.v.cta}`;
      const over = text.length > maxChars;
      // the body gives way first; title and call to action stay whole
      const room = Math.max(200, maxChars - r.v.title.length - r.v.cta.length);
      return {
        platform: r.platform,
        format: r.format,
        title: r.v.title,
        body: over ? `${r.v.body.slice(0, room)}\n[truncated]` : r.v.body,
        cta: r.v.cta,
      };
    });
  }

  /** Readable, active reference documents of a business (same rule as `usableWhere`). */
  documents(businessId: string) {
    return this.businesses.readableReferences(businessId);
  }

  businessById(businessId: string) {
    return this.businesses.promptProfile(businessId);
  }

  /** Active notes of the business, newest first (`exceptId`: the note being applied now). */
  standingNotes(businessId: string, exceptId?: string) {
    return this.businesses.standingNotes(businessId, exceptId);
  }

  /** The topic's active APPROVED profile with its traits, or null. */
  async activeProfile(topicId: string) {
    const topic = await this.prisma.topic.findUniqueOrThrow({
      where: { id: topicId },
      select: { activeProfileId: true },
    });
    if (!topic.activeProfileId) return null;
    return this.prisma.contentProfile.findFirst({
      where: { id: topic.activeProfileId, status: 'APPROVED' },
      include: { traits: { orderBy: [{ category: 'asc' }, { confidence: 'desc' }] } },
    });
  }
}
