import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Campaign, CreateCampaignInput, UpdateCampaignInput } from '@contenter/shared';
import { api } from '@/lib/api-client';

export const campaignKeys = {
  all: ['campaigns'] as const,
  topic: (topicId: string) => ['campaigns', topicId] as const,
};

/** The campaigns of one topic, with how many contents each holds. */
export function useCampaigns(topicId: string | undefined) {
  return useQuery({
    queryKey: campaignKeys.topic(topicId ?? ''),
    queryFn: () => api.get<Campaign[]>(`/topics/${topicId}/campaigns`),
    enabled: !!topicId,
  });
}

/** A campaign shows on its contents, so its changes refresh the content lists too. */
function useInvalidateCampaigns() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: campaignKeys.all });
    void qc.invalidateQueries({ queryKey: ['contents'] });
  };
}

export function useCreateCampaign(topicId: string) {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (data: CreateCampaignInput) =>
      api.post<Campaign>(`/topics/${topicId}/campaigns`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCampaignInput }) =>
      api.patch<Campaign>(`/campaigns/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: invalidate,
  });
}
