import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BusinessCompetitor,
  CreateBusinessCompetitorInput,
  UpdateBusinessCompetitorInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';

/** Competitor cards (docs/70). */
export const competitorKeys = {
  list: (businessId: string) => [...businessKeys.one(businessId), 'competitors'] as const,
};

export function useCompetitors(businessId: string | null | undefined) {
  return useQuery({
    queryKey: competitorKeys.list(businessId ?? ''),
    queryFn: () => api.get<BusinessCompetitor[]>(`/businesses/${businessId}/competitors`),
    enabled: !!businessId,
  });
}

export function useCreateCompetitor(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBusinessCompetitorInput) =>
      api.post<BusinessCompetitor>(`/businesses/${businessId}/competitors`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: competitorKeys.list(businessId) }),
  });
}

export function useUpdateCompetitor(businessId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateBusinessCompetitorInput) =>
      api.patch<BusinessCompetitor>(`/business-competitors/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: competitorKeys.list(businessId) }),
  });
}

export function useDeleteCompetitor(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/business-competitors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: competitorKeys.list(businessId) }),
  });
}

/** Writes the active cards into the COMPETITORS section; the profile and what the model sees change. */
export function useAddCompetitorsToProfile(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ key: string; length: number }>(`/businesses/${businessId}/competitors/add-to-profile`),
    onSuccess: () => qc.invalidateQueries({ queryKey: businessKeys.one(businessId) }),
  });
}
