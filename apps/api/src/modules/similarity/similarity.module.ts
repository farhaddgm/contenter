import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  contentSimilarity,
  type SimilarityCandidate,
  type SimilarityReport,
} from '@contenter/shared';
import { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessApi } from '../businesses/business-api';
import { SettingsService } from '../settings/settings.module';

/** How many of each kind are compared (the newest first); keeps one detail request cheap. */
const MAX_CONTENTS = 300;
const MAX_IDEAS = 300;
const MAX_SAMPLES = 100;
const MAX_REFERENCES = 50;
/** A reference can be a whole document; the start is enough to catch copied wording. */
const REFERENCE_CHARS = 30_000;

export interface SimilaritySubject {
  id: string;
  topicId: string;
  businessId: string | null;
  ideaId: string | null;
  sourceContentId: string | null;
  /** Drafts written together are alternatives on purpose, so they are not compared (docs/51). */
  variantGroupId?: string | null;
  title: string;
  body: string;
}

const clip = (s: string | null | undefined, n: number) => (s ?? '').slice(0, n);

/**
 * Literal similarity of a draft to the rest of the business (docs/48-similarity.md): other
 * contents, ideas, samples and reference documents. Code only (`contentSimilarity`); it warns and
 * never blocks. The candidates are limited to what the caller may see.
 */
@Injectable()
export class SimilarityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly businesses: BusinessApi,
  ) {}

  async forContent(user: AuthUser, c: SimilaritySubject): Promise<SimilarityReport> {
    const [thresholds, candidates] = await Promise.all([
      this.settings.getSimilarity(),
      this.candidates(user, c),
    ]);
    return contentSimilarity(`${c.title}\n${c.body}`, candidates, thresholds);
  }

  private async candidates(user: AuthUser, c: SimilaritySubject): Promise<SimilarityCandidate[]> {
    // the whole business when the project has one, else just the project
    const scope: Prisma.TopicWhereInput = c.businessId
      ? { businessId: c.businessId }
      : { id: c.topicId };
    const visible = this.access.visibleTopics(user);
    const topic: Prisma.TopicWhereInput = visible ? { AND: [scope, visible] } : scope;

    // a version made for another platform is a rewrite of its source on purpose: leave out the
    // content itself, its source, its repurposed versions and the versions made from the same
    // source. (`NOT` on a nullable column would drop the rows where it is NULL, so spell it out.)
    const family = c.sourceContentId ? [c.id, c.sourceContentId] : [c.id];

    const [contents, ideas, samples, references] = await Promise.all([
      this.prisma.content.findMany({
        where: {
          id: { notIn: family },
          OR: [{ sourceContentId: null }, { sourceContentId: { notIn: family } }],
          ...(c.variantGroupId
            ? { AND: [{ OR: [{ variantGroupId: null }, { variantGroupId: { not: c.variantGroupId } }] }] }
            : {}),
          topic,
          currentVersionId: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_CONTENTS,
        select: {
          id: true,
          topicId: true,
          title: true,
          currentVersion: { select: { title: true, body: true } },
        },
      }),
      this.prisma.idea.findMany({
        where: { topic, ...(c.ideaId ? { id: { not: c.ideaId } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: MAX_IDEAS,
        select: { id: true, topicId: true, title: true, angle: true, hook: true, outline: true },
      }),
      this.prisma.sampleContent.findMany({
        where: { topic },
        orderBy: { createdAt: 'desc' },
        take: MAX_SAMPLES,
        select: { id: true, topicId: true, url: true, manualText: true, fetched: true },
      }),
      this.referencesFor(user, c.businessId),
    ]);

    const out: SimilarityCandidate[] = [];
    for (const x of contents) {
      if (!x.currentVersion) continue;
      out.push({
        kind: 'CONTENT',
        id: x.id,
        title: x.title,
        text: `${x.currentVersion.title}\n${x.currentVersion.body}`,
        topicId: x.topicId,
      });
    }
    for (const x of ideas) {
      out.push({
        kind: 'IDEA',
        id: x.id,
        title: x.title,
        text: [x.title, x.angle, x.hook, ...x.outline].join('\n'),
        topicId: x.topicId,
      });
    }
    for (const x of samples) {
      const fetched = (x.fetched ?? {}) as { title?: string | null; text?: string | null };
      out.push({
        kind: 'SAMPLE',
        id: x.id,
        title: fetched.title || x.url,
        text: [x.manualText, fetched.text ?? ''].join('\n'),
        topicId: x.topicId,
      });
    }
    for (const x of references) {
      out.push({
        kind: 'REFERENCE',
        id: x.id,
        title: x.title || x.url || x.id,
        text: clip(x.content, REFERENCE_CHARS),
        businessId: c.businessId,
      });
    }
    return out;
  }

  /** Reference documents belong to the business, so they need access to the business itself. */
  private async referencesFor(user: AuthUser, businessId: string | null) {
    if (!businessId) return [];
    try {
      await this.access.assert(user, 'business', businessId, 'VIEW');
    } catch {
      return [];
    }
    return this.businesses.readableReferences(businessId, { order: 'recent', take: MAX_REFERENCES });
  }
}

@Global()
@Module({ providers: [SimilarityService], exports: [SimilarityService] })
export class SimilarityModule {}
