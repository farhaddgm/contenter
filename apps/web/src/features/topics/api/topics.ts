import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePrincipleInput,
  CreateTopicInput,
  Paginated,
  Principle,
  Topic,
  TopicStatus,
  UpdatePrincipleInput,
  UpdateTopicInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const topicKeys = {
  all: ['topics'] as const,
  list: (p: object) => ['topics', 'list', p] as const,
  one: (id: string) => ['topics', id] as const,
  principles: (id: string | null) => ['principles', id ?? 'global'] as const,
};

export function useTopics(params: {
  page: number;
  q?: string;
  status?: TopicStatus | '';
  pageSize?: number;
}) {
  return useQuery({
    queryKey: topicKeys.list(params),
    queryFn: () => api.get<Paginated<Topic>>('/topics', { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useTopic(id: string) {
  return useQuery({ queryKey: topicKeys.one(id), queryFn: () => api.get<Topic>(`/topics/${id}`) });
}

export function useCreateTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTopicInput) => api.post<Topic>('/topics', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: topicKeys.all }),
  });
}

export function useUpdateTopic(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateTopicInput) => api.patch<Topic>(`/topics/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: topicKeys.all }),
  });
}

export function useDeleteTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/topics/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: topicKeys.all }),
  });
}

// ---------- principles (topicId null = global) ----------

const principlesBase = (topicId: string | null) =>
  topicId ? `/topics/${topicId}/principles` : '/principles/global';

export function usePrinciples(topicId: string | null) {
  return useQuery({
    queryKey: topicKeys.principles(topicId),
    queryFn: () => api.get<Principle[]>(principlesBase(topicId)),
  });
}

export function useCreatePrinciple(topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePrincipleInput) => api.post<Principle>(principlesBase(topicId), data),
    onSuccess: () => qc.invalidateQueries({ queryKey: topicKeys.principles(topicId) }),
  });
}

export function useUpdatePrinciple(topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePrincipleInput }) =>
      api.patch<Principle>(`/principles/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: topicKeys.principles(topicId) }),
  });
}

export function useDeletePrinciple(topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/principles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: topicKeys.principles(topicId) }),
  });
}
