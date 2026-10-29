import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BusinessSegment,
  CreateBusinessSegmentInput,
  JobAccepted,
  UpdateBusinessSegmentInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';
import { offeringKeys } from './offerings';

/** The audiences (markets and personas) of a business (docs/73). */
export const segmentKeys = {
  list: (businessId: string) => [...businessKeys.one(businessId), 'segments'] as const,
};

export function useSegments(businessId: string | null | undefined) {
  return useQuery({
    queryKey: segmentKeys.list(businessId ?? ''),
    queryFn: () => api.get<BusinessSegment[]>(`/businesses/${businessId}/segments`),
    enabled: !!businessId,
  });
}

/** An audience changed: its own list, and the offerings that show who they are for. */
function useInvalidateSegments(businessId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: segmentKeys.list(businessId) });
    void qc.invalidateQueries({ queryKey: offeringKeys.list(businessId) });
  };
}

export function useCreateSegment(businessId: string) {
  const invalidate = useInvalidateSegments(businessId);
  return useMutation({
    mutationFn: (data: CreateBusinessSegmentInput) =>
      api.post<BusinessSegment>(`/businesses/${businessId}/segments`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateSegment(businessId: string, id: string) {
  const invalidate = useInvalidateSegments(businessId);
  return useMutation({
    mutationFn: (data: UpdateBusinessSegmentInput) =>
      api.patch<BusinessSegment>(`/business-segments/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteSegment(businessId: string) {
  const invalidate = useInvalidateSegments(businessId);
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/business-segments/${id}`),
    onSuccess: invalidate,
  });
}

/** The admin read an AI-proposed audience and accepts it. */
export function useConfirmSegment(businessId: string) {
  const invalidate = useInvalidateSegments(businessId);
  return useMutation({
    mutationFn: (id: string) => api.post<BusinessSegment>(`/business-segments/${id}/confirm`),
    onSuccess: invalidate,
  });
}

/** Asks the model to propose audiences; they wait, unused, for the admin to confirm them. */
export function useProposeSegments(businessId: string) {
  return useMutation({
    mutationFn: () => api.post<JobAccepted>(`/businesses/${businessId}/segments/propose`),
  });
}
