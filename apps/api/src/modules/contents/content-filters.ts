import type { Prisma } from '@prisma/client';
import { ContentListQuerySchema, NO_CAMPAIGN } from '@contenter/shared';
import type { z } from 'zod';
import { has, matchAllWords } from '../../common/search-where';

type Query = z.infer<typeof ContentListQuerySchema>;

/** The text fields of a content a word is looked for in: its own and its current draft's. */
export function contentTextConditions(spelling: string): Prisma.ContentWhereInput[] {
  return [
    { title: has(spelling) },
    { brief: has(spelling) },
    {
      currentVersion: {
        is: {
          OR: [
            { title: has(spelling) },
            { body: has(spelling) },
            { cta: has(spelling) },
            { notes: has(spelling) },
            { hashtags: { has: spelling } },
          ],
        },
      },
    },
  ];
}

/**
 * The `where` of the content list (docs/24-search-filters.md). Different filters narrow each
 * other; several values of one filter (statuses, formats, platforms, tags) widen it.
 */
export function buildContentWhere(
  query: Query,
  visibleTopics: Prisma.TopicWhereInput | undefined,
  now: Date = new Date(),
): Prisma.ContentWhereInput {
  const and: Prisma.ContentWhereInput[] = [];

  if (visibleTopics) and.push({ topic: visibleTopics });
  if (query.topicId) and.push({ topicId: query.topicId });

  const statuses = [...(query.statuses ?? []), ...(query.status ? [query.status] : [])];
  if (statuses.length) and.push({ status: { in: statuses } });

  if (query.formats?.length) and.push({ format: { in: query.formats } });

  // a content is for its own platform, else for its topic's
  if (query.platforms?.length) {
    and.push({
      OR: [
        { platform: { in: query.platforms } },
        { platform: null, topic: { platform: { in: query.platforms } } },
      ],
    });
  }

  const tagIds = [...(query.tagIds ?? []), ...(query.tagId ? [query.tagId] : [])];
  if (tagIds.length) and.push({ tags: { some: { id: { in: tagIds } } } });

  if (query.campaignId) {
    and.push({ campaignId: query.campaignId === NO_CAMPAIGN ? null : query.campaignId });
  }
  if (query.createdById) and.push({ createdById: query.createdById });

  switch (query.schedule) {
    case 'planned':
      and.push({ scheduledAt: { not: null }, publishedAt: null });
      break;
    case 'unplanned':
      // approved and waiting for a plan: the "ready to schedule" list of the calendar
      and.push({ status: 'APPROVED', scheduledAt: null, publishedAt: null });
      break;
    case 'overdue':
      and.push({ scheduledAt: { lt: now }, publishedAt: null });
      break;
    case 'published':
      and.push({ publishedAt: { not: null } });
      break;
  }

  if (query.createdFrom || query.createdTo) {
    and.push({
      createdAt: {
        ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
        ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
      },
    });
  }

  const words = matchAllWords(query.q, contentTextConditions);
  if (words) and.push(words);

  return and.length ? { AND: and } : {};
}

export function buildContentOrderBy(
  sort: Query['sort'],
  order: Query['order'],
): Prisma.ContentOrderByWithRelationInput[] {
  switch (sort) {
    case 'created':
      return [{ createdAt: order }, { id: 'asc' }];
    case 'title':
      return [{ title: order }, { id: 'asc' }];
    case 'scheduled':
      // contents with no plan go last whichever way the plan is sorted
      return [
        { scheduledAt: { sort: order, nulls: 'last' } },
        { updatedAt: 'desc' },
        { id: 'asc' },
      ];
    default:
      return [{ updatedAt: order }, { id: 'asc' }];
  }
}
