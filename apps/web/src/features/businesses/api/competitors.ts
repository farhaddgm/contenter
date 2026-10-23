import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddStyleSourceInput,
  BusinessCompetitor,
  CompareReport,
  CompetitorSourceSummary,
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

// ---------- sources and comparison (docs/70 phase 2) ----------

export const competitorSourceKeys = {
  list: (competitorId: string) => ['competitor-sources', competitorId] as const,
  text: (id: string) => ['competitor-source-text', id] as const,
  compare: (businessId: string) => [...competitorKeys.list(businessId), 'compare'] as const,
};

export function useCompetitorSources(competitorId: string, enabled: boolean) {
  return useQuery({
    queryKey: competitorSourceKeys.list(competitorId),
    queryFn: () => api.get<CompetitorSourceSummary[]>(`/business-competitors/${competitorId}/sources`),
    enabled,
  });
}

/** A source changed: its list and the comparison (which reads the Instagram numbers) are stale. */
function useInvalidateSources(businessId: string, competitorId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: competitorSourceKeys.list(competitorId) });
    void qc.invalidateQueries({ queryKey: competitorSourceKeys.compare(businessId) });
  };
}

export function useAddCompetitorSource(businessId: string, competitorId: string) {
  const invalidate = useInvalidateSources(businessId, competitorId);
  return useMutation({
    mutationFn: (data: AddStyleSourceInput) =>
      api.post<CompetitorSourceSummary>(`/business-competitors/${competitorId}/sources`, data),
    onSuccess: invalidate,
  });
}

export function useRefreshCompetitorSource(businessId: string, competitorId: string) {
  const invalidate = useInvalidateSources(businessId, competitorId);
  return useMutation({
    mutationFn: (id: string) =>
      api.post<CompetitorSourceSummary>(`/business-competitor-sources/${id}/refresh`),
    onSuccess: invalidate,
  });
}

export function useDeleteCompetitorSource(businessId: string, competitorId: string) {
  const invalidate = useInvalidateSources(businessId, competitorId);
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/business-competitor-sources/${id}`),
    onSuccess: invalidate,
  });
}

/** The stored snapshot of a source, so the admin sees exactly what was read. */
export function useCompetitorSourceText(id: string | null | undefined) {
  return useQuery({
    queryKey: competitorSourceKeys.text(id ?? ''),
    queryFn: () =>
      api.get<CompetitorSourceSummary & { content: string }>(`/business-competitor-sources/${id}`),
    enabled: !!id,
  });
}

export function useCompetitorCompare(businessId: string, enabled: boolean) {
  return useQuery({
    queryKey: competitorSourceKeys.compare(businessId),
    queryFn: () => api.get<CompareReport>(`/businesses/${businessId}/competitors/compare`),
    enabled,
  });
}
