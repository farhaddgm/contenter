import { useQuery } from '@tanstack/react-query';
import type { ContextReport, ContextTarget } from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';

/** What the model reads about a business, block by block (docs/66). Reading it calls no model. */
export const contextKeys = {
  preview: (businessId: string, target: ContextTarget, topicId: string) =>
    [...businessKeys.one(businessId), 'context-preview', target, topicId] as const,
};

export function useContextPreview(businessId: string, target: ContextTarget, topicId: string) {
  return useQuery({
    queryKey: contextKeys.preview(businessId, target, topicId),
    queryFn: () => {
      const qs = new URLSearchParams({ target });
      if (topicId) qs.set('topicId', topicId);
      return api.get<ContextReport>(`/businesses/${businessId}/context-preview?${qs}`);
    },
    // the profile changes as people edit it; never serve a stale picture of it
    staleTime: 0,
  });
}
