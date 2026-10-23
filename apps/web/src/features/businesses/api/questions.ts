import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileQuestionList } from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';

/** Questions that fill the profile's gaps (docs/72). */
export const questionKeys = {
  list: (businessId: string) => [...businessKeys.one(businessId), 'questions'] as const,
};

export function useProfileQuestions(businessId: string | null | undefined) {
  return useQuery({
    queryKey: questionKeys.list(businessId ?? ''),
    queryFn: () => api.get<ProfileQuestionList>(`/businesses/${businessId}/questions`),
    enabled: !!businessId,
  });
}

/** The answer changed a section: the profile, its health and what the model sees are stale too. */
export function useAnswerQuestion(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { code: string; answer: string }) =>
      api.post<ProfileQuestionList>(`/businesses/${businessId}/questions/answer`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: businessKeys.one(businessId) }),
  });
}

export function useSkipQuestion(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api.post<ProfileQuestionList>(`/businesses/${businessId}/questions/skip`, { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: questionKeys.list(businessId) }),
  });
}

export function useResetSkippedQuestions(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<ProfileQuestionList>(`/businesses/${businessId}/questions/skips`),
    onSuccess: () => qc.invalidateQueries({ queryKey: questionKeys.list(businessId) }),
  });
}
