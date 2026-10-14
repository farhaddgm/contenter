import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VariantGroup, VariantSettings } from '@contenter/shared';
import { api } from '@/lib/api-client';

const groupKey = (contentId: string) => ['contents', 'variants', contentId] as const;

/** The drafts written together with this content; refreshes while one is still being written. */
export function useVariantGroup(contentId: string) {
  return useQuery({
    queryKey: groupKey(contentId),
    queryFn: () => api.get<VariantGroup>(`/contents/${contentId}/variants`),
    refetchInterval: (q) =>
      q.state.data?.items.some((i) => i.status === 'GENERATING') ? 3000 : false,
  });
}

/** Chooses one draft: the other drafts that are still drafts go to REJECTED. */
export function usePickVariant(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<VariantGroup>(`/contents/${id}/variants/pick`),
    onSuccess: (group) => {
      qc.setQueryData(groupKey(contentId), group);
      void qc.invalidateQueries({ queryKey: ['contents'] });
    },
  });
}

/** How many drafts one request may ask for. */
export function useVariantLimit(topicId: string) {
  return useQuery({
    queryKey: ['topics', topicId, 'variant-limit'],
    queryFn: () => api.get<VariantSettings>(`/topics/${topicId}/variant-limit`),
  });
}
