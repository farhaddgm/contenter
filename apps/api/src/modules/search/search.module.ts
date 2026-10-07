import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  countMatches,
  effectivePlatform,
  makeSnippet,
  SearchQuerySchema,
  searchTerms,
  type SearchHit,
  type SearchResponse,
  type Tag,
  type TagColor,
} from '@contenter/shared';
import type { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { AccessService } from '../../common/access';
import { has, matchAllWords } from '../../common/search-where';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { contentTextConditions } from '../contents/content-filters';
import { TAG_SELECT } from '../tags/tag-select';

/** Rows read per kind before ranking; the best `limit` of them are returned. */
const CANDIDATES = 40;
const SNIPPET_FALLBACK_CHARS = 140;

type Query = z.infer<typeof SearchQuerySchema>;

const toTag = (t: {
  id: string;
  topicId: string;
  name: string;
  color: string;
  createdAt: Date;
}): Tag => ({
  ...t,
  color: t.color as TagColor,
  createdAt: t.createdAt.toISOString(),
});

/** Points for finding the words in a field: a title counts more than a long body. */
function points(text: string | null | undefined, terms: string[], weight: number, cap = 3) {
  return text ? Math.min(cap, countMatches(text, terms)) * weight : 0;
}

/** The first of the fields that contains a word, as a snippet around it. */
function snippetFrom(fields: (string | null | undefined)[], terms: string[]): string {
  for (const f of fields) {
    const s = f ? makeSnippet(f, terms) : '';
    if (s) return s;
  }
  return '';
}

/**
 * Search across contents, ideas and topics (docs/24-search-filters.md): every word must occur
 * somewhere in the record, in any keyboard spelling of Persian letters and digits. Plain
 * case-insensitive matching in the database, ranked and excerpted by code. No AI.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async search(query: Query, user: AuthUser): Promise<SearchResponse> {
    const terms = searchTerms(query.q);
    if (!terms.length) return { terms, contents: [], ideas: [], topics: [] };
    const visible = this.access.visibleTopics(user);
    const inTopic = {
      ...(visible ? { topic: visible } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
    };

    const [contents, ideas, topics] = await Promise.all([
      this.prisma.content.findMany({
        where: { ...inTopic, ...matchAllWords(query.q, contentTextConditions) },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATES,
        include: {
          topic: { select: { id: true, title: true, platform: true } },
          tags: { select: TAG_SELECT, orderBy: { name: 'asc' } },
          currentVersion: { select: { title: true, body: true, cta: true, notes: true } },
        },
      }),
      this.prisma.idea.findMany({
        where: {
          ...inTopic,
          ...matchAllWords<Prisma.IdeaWhereInput>(query.q, (v) => [
            { title: has(v) },
            { angle: has(v) },
            { hook: has(v) },
            { rationale: has(v) },
          ]),
        },
        orderBy: { createdAt: 'desc' },
        take: CANDIDATES,
        include: {
          topic: { select: { id: true, title: true } },
          tags: { select: TAG_SELECT, orderBy: { name: 'asc' } },
        },
      }),
      this.prisma.topic.findMany({
        where: {
          AND: [
            ...(visible ? [visible] : []),
            ...(query.topicId ? [{ id: query.topicId }] : []),
            ...(matchAllWords<Prisma.TopicWhereInput>(query.q, (v) => [
              { title: has(v) },
              { description: has(v) },
              { audience: has(v) },
            ])?.AND ?? []),
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATES,
      }),
    ]);

    const rank = (hits: SearchHit[]) =>
      hits.sort((a, b) => b.score - a.score).slice(0, query.limit);

    return {
      terms,
      contents: rank(
        contents.map((c) => {
          const v = c.currentVersion;
          return {
            id: c.id,
            title: c.title,
            snippet:
              snippetFrom([v?.body, c.brief, v?.cta, v?.notes], terms) ||
              (v?.body ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_FALLBACK_CHARS),
            topic: { id: c.topic.id, title: c.topic.title },
            status: c.status,
            format: c.format,
            platform: effectivePlatform(c, c.topic),
            tags: c.tags.map(toTag),
            score:
              points(c.title, terms, 5, 2) +
              points(v?.title, terms, 3, 2) +
              points(c.brief, terms, 2) +
              points(v?.cta, terms, 1) +
              points(v?.notes, terms, 1) +
              points(v?.body, terms, 1, 5),
          };
        }),
      ),
      ideas: rank(
        ideas.map((i) => ({
          id: i.id,
          title: i.title,
          snippet:
            snippetFrom([i.hook, i.angle, i.rationale], terms) ||
            i.angle.slice(0, SNIPPET_FALLBACK_CHARS),
          topic: i.topic,
          status: i.status,
          format: i.format,
          tags: i.tags.map(toTag),
          score:
            points(i.title, terms, 5, 2) +
            points(i.hook, terms, 3) +
            points(i.angle, terms, 3) +
            points(i.rationale, terms, 1),
        })),
      ),
      topics: rank(
        topics.map((t) => ({
          id: t.id,
          title: t.title,
          snippet:
            snippetFrom([t.description, t.audience], terms) ||
            t.description.slice(0, SNIPPET_FALLBACK_CHARS),
          topic: null,
          platform: t.platform,
          status: t.status,
          score:
            points(t.title, terms, 5, 2) +
            points(t.description, terms, 2) +
            points(t.audience, terms, 1),
        })),
      ),
    };
  }
}

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: Query,
    @CurrentUser() user: AuthUser,
  ) {
    return this.search.search(query, user);
  }
}

@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
