import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSampleInput,
  JobAccepted,
  SampleContent,
  UpdateSampleInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const sampleKeys = {
  list: (topicId: string) => ['samples', topicId] as const,
};

export function useSamples(topicId: string) {
  return useQuery({
    queryKey: sampleKeys.list(topicId),
    queryFn: () => api.get<SampleContent[]>(`/topics/${topicId}/samples`),
    // keep the list fresh while analyses are running
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.analysisStatus === 'QUEUED') ? 2500 : false,
  });
}

export function useCreateSample(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSampleInput) =>
      api.post<SampleContent>(`/topics/${topicId}/samples`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sampleKeys.list(topicId) });
      void qc.invalidateQueries({ queryKey: ['topics'] });
    },
  });
}

export function useUpdateSample(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSampleInput }) =>
      api.patch<SampleContent>(`/samples/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: sampleKeys.list(topicId) }),
  });
}

export function useAnalyzeSample(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<JobAccepted>(`/samples/${id}/analyze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sampleKeys.list(topicId) }),
  });
}

export function useRefetchSample(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SampleContent>(`/samples/${id}/refetch`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sampleKeys.list(topicId) }),
  });
}

export function useDeleteSample(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/samples/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sampleKeys.list(topicId) });
      void qc.invalidateQueries({ queryKey: ['topics'] });
    },
  });
}
