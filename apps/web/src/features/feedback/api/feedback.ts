import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FeedbackSummary,
  FeedbackTarget,
  MyFeedback,
  SetFeedbackInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

const mineKey = (targetType: FeedbackTarget, topicId: string) =>
  ['ai-feedback', 'mine', targetType, topicId] as const;

/** The caller's own votes on the outputs of one topic. */
export function useMyFeedback(targetType: FeedbackTarget, topicId: string) {
  return useQuery({
    queryKey: mineKey(targetType, topicId),
    queryFn: () => api.get<MyFeedback[]>('/ai-feedback/mine', { targetType, topicId }),
  });
}

export function useSetFeedback(targetType: FeedbackTarget, topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, ...body }: SetFeedbackInput & { targetId: string }) =>
      api.put<MyFeedback>(`/ai-feedback/${targetType}/${targetId}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mineKey(targetType, topicId) });
      void qc.invalidateQueries({ queryKey: ['ai-feedback', 'summary'] });
    },
  });
}

export function useRemoveFeedback(targetType: FeedbackTarget, topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => api.delete(`/ai-feedback/${targetType}/${targetId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mineKey(targetType, topicId) });
      void qc.invalidateQueries({ queryKey: ['ai-feedback', 'summary'] });
    },
  });
}

/** Back-office: votes per prompt version and model. */
export function useFeedbackSummary(days: number) {
  return useQuery({
    queryKey: ['ai-feedback', 'summary', days],
    queryFn: () => api.get<FeedbackSummary>('/admin/ai-feedback/summary', { days }),
  });
}
