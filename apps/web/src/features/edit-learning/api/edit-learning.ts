import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptLearningSuggestionInput,
  EditLearningOverview,
  JobAccepted,
  Principle,
} from '@contenter/shared';
import { api } from '@/lib/api-client';
import { topicKeys } from '@/features/topics/api/topics';

export const editLearningKeys = {
  overview: (topicId: string) => ['edit-learning', topicId] as const,
};

export function useEditLearning(topicId: string) {
  return useQuery({
    queryKey: editLearningKeys.overview(topicId),
    queryFn: () => api.get<EditLearningOverview>(`/topics/${topicId}/edit-learning`),
  });
}

/** Queues the analysis; the panel then waits for the job like any other AI job. */
export function useAnalyzeEdits(topicId: string) {
  return useMutation({
    mutationFn: () => api.post<JobAccepted>(`/topics/${topicId}/edit-learning/analyze`),
  });
}

/** Accepting creates a principle, so the principles list is refreshed too. */
export function useAcceptSuggestion(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AcceptLearningSuggestionInput }) =>
      api.post<Principle>(`/learning-suggestions/${id}/accept`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: editLearningKeys.overview(topicId) });
      void qc.invalidateQueries({ queryKey: topicKeys.principles(topicId) });
    },
  });
}

export function useDismissSuggestion(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/learning-suggestions/${id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: editLearningKeys.overview(topicId) }),
  });
}
