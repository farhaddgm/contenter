import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Idea, IdeaStatus, IdeateInput, Paginated, UpdateIdeaInput } from '@contenter/shared';
import { api } from '@/lib/api-client';

export const ideaKeys = {
  all: ['ideas'] as const,
  list: (topicId: string, p: object) => ['ideas', topicId, p] as const,
};

export function useIdeas(
  topicId: string,
  params: { page: number; status?: IdeaStatus | ''; pageSize?: number; q?: string },
) {
  return useQuery({
    queryKey: ideaKeys.list(topicId, params),
    queryFn: () => api.get<Paginated<Idea>>(`/topics/${topicId}/ideas`, { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useIdeate(topicId: string) {
  return useMutation({
    mutationFn: (data: IdeateInput) =>
      api.post<{ jobId: string; requestId: string }>(`/topics/${topicId}/ideas/generate`, data),
  });
}

export function useUpdateIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIdeaInput }) =>
      api.patch<Idea>(`/ideas/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ideaKeys.all }),
  });
}

export function useDeleteIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ideas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ideaKeys.all }),
  });
}
