import { useQuery } from '@tanstack/react-query';
import type { StaleReport } from '@contenter/shared';
import { api } from '@/lib/api-client';

/** Approved or published contents that clash with a changed or expired key fact (docs/61). */
export function useStaleContents(businessId: string) {
  return useQuery({
    queryKey: ['businesses', businessId, 'stale-contents'],
    queryFn: () => api.get<StaleReport>(`/businesses/${businessId}/stale-contents`),
  });
}
