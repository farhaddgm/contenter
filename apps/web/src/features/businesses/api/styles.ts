import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddStyleSourceInput,
  BusinessStyleDetail,
  BusinessStyleSummary,
  CreateBusinessStyleInput,
  JobAccepted,
  StyleSourceSummary,
  UpdateBusinessStyleInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';

/** Imitation styles of a business and their sources (docs/64). */
export const styleKeys = {
  list: (businessId: string) => [...businessKeys.one(businessId), 'styles'] as const,
  one: (id: string) => ['business-styles', id] as const,
  source: (id: string) => ['style-sources', id] as const,
};

export function useStyles(businessId: string | null | undefined) {
  return useQuery({
    queryKey: styleKeys.list(businessId ?? ''),
    queryFn: () => api.get<BusinessStyleSummary[]>(`/businesses/${businessId}/styles`),
    enabled: !!businessId,
  });
}

export function useStyle(id: string | null | undefined) {
  return useQuery({
    queryKey: styleKeys.one(id ?? ''),
    queryFn: () => api.get<BusinessStyleDetail>(`/business-styles/${id}`),
    enabled: !!id,
  });
}

/** One style changed: refresh its detail, the list it appears in and the projects that use it. */
function useInvalidateStyles(businessId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: styleKeys.list(businessId) });
    void qc.invalidateQueries({ queryKey: ['business-styles'] });
    void qc.invalidateQueries({ queryKey: ['topics'] });
  };
}

export function useCreateStyle(businessId: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: (data: CreateBusinessStyleInput) =>
      api.post<BusinessStyleDetail>(`/businesses/${businessId}/styles`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateStyle(businessId: string, id: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: (data: UpdateBusinessStyleInput) =>
      api.patch<BusinessStyleDetail>(`/business-styles/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteStyle(businessId: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/business-styles/${id}`),
    onSuccess: invalidate,
  });
}

export function useBuildStyle(businessId: string, id: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: () => api.post<JobAccepted & { id: string }>(`/business-styles/${id}/build`),
    onSuccess: invalidate,
  });
}

export function useReviewStyle(businessId: string, id: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: () => api.post<BusinessStyleDetail>(`/business-styles/${id}/review`),
    onSuccess: invalidate,
  });
}

export function useAddStyleSource(businessId: string, styleId: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: (data: AddStyleSourceInput) =>
      api.post<StyleSourceSummary>(`/business-styles/${styleId}/sources`, data),
    onSuccess: invalidate,
  });
}

export function useRefreshStyleSource(businessId: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: (id: string) => api.post<StyleSourceSummary>(`/style-sources/${id}/refresh`),
    onSuccess: invalidate,
  });
}

export function useDeleteStyleSource(businessId: string) {
  const invalidate = useInvalidateStyles(businessId);
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/style-sources/${id}`),
    onSuccess: invalidate,
  });
}

/** The stored text snapshot of a source (exactly what AI reads). */
export function useStyleSourceText(id: string | null | undefined) {
  return useQuery({
    queryKey: styleKeys.source(id ?? ''),
    queryFn: () => api.get<StyleSourceSummary & { content: string }>(`/style-sources/${id}`),
    enabled: !!id,
  });
}
