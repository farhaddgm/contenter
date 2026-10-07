import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchResponse } from '@contenter/shared';
import { api } from '@/lib/api-client';

/** At least two characters; shorter queries are not sent. */
export const MIN_SEARCH_LENGTH = 2;

export function useSearch(q: string, topicId?: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', query, topicId ?? ''],
    queryFn: () => api.get<SearchResponse>('/search', { q: query, topicId, limit: 10 }),
    enabled: query.length >= MIN_SEARCH_LENGTH,
    placeholderData: keepPreviousData,
  });
}
