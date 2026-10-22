import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BusinessOffering,
  CreateBusinessOfferingInput,
  JobAccepted,
  UpdateBusinessOfferingInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';

/** The catalog of what a business sells (docs/67). */
export const offeringKeys = {
  list: (businessId: string) => [...businessKeys.one(businessId), 'offerings'] as const,
};

export function useOfferings(businessId: string | null | undefined) {
  return useQuery({
    queryKey: offeringKeys.list(businessId ?? ''),
    queryFn: () => api.get<BusinessOffering[]>(`/businesses/${businessId}/offerings`),
    enabled: !!businessId,
  });
}

/** A row changed: refresh the list, and what the model sees (the catalog is part of it). */
function useInvalidateOfferings(businessId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: offeringKeys.list(businessId) });
    void qc.invalidateQueries({ queryKey: [...businessKeys.one(businessId), 'context-preview'] });
  };
}

export function useCreateOffering(businessId: string) {
  const invalidate = useInvalidateOfferings(businessId);
  return useMutation({
    mutationFn: (data: CreateBusinessOfferingInput) =>
      api.post<BusinessOffering>(`/businesses/${businessId}/offerings`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateOffering(businessId: string, id: string) {
  const invalidate = useInvalidateOfferings(businessId);
  return useMutation({
    mutationFn: (data: UpdateBusinessOfferingInput) =>
      api.patch<BusinessOffering>(`/business-offerings/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useConfirmOffering(businessId: string) {
  const invalidate = useInvalidateOfferings(businessId);
  return useMutation({
    mutationFn: (id: string) => api.post<BusinessOffering>(`/business-offerings/${id}/confirm`),
    onSuccess: invalidate,
  });
}

export function useDeleteOffering(businessId: string) {
  const invalidate = useInvalidateOfferings(businessId);
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/business-offerings/${id}`),
    onSuccess: invalidate,
  });
}

export function useExtractOfferings(businessId: string) {
  return useMutation({
    mutationFn: () => api.post<JobAccepted>(`/businesses/${businessId}/offerings/extract`),
  });
}
