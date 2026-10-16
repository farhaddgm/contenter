import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GoldenList } from '@contenter/shared';
import { api } from '@/lib/api-client';

const key = (businessId: string) => ['businesses', businessId, 'golden'] as const;

export function useGoldenExamples(businessId: string) {
  return useQuery({
    queryKey: key(businessId),
    queryFn: () => api.get<GoldenList>(`/businesses/${businessId}/golden`),
  });
}

/** Marks or unmarks one content (admin). Every list of golden examples and the content itself refresh. */
export function useSetGolden(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (golden: boolean) =>
      api.put<{ goldenAt: string | null }>(`/contents/${contentId}/golden`, { golden }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contents'] });
      void qc.invalidateQueries({ queryKey: ['businesses'] });
    },
  });
}
