import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Content,
  ContentStatus,
  EditContentVersionInput,
  GenerateContentInput,
  Paginated,
  UpdateContentInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const contentKeys = {
  all: ['contents'] as const,
  list: (p: object) => ['contents', 'list', p] as const,
  one: (id: string) => ['contents', id] as const,
};

export function useContents(params: {
  page: number;
  status?: ContentStatus | '';
  topicId?: string;
  tagId?: string;
  campaignId?: string;
  q?: string;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: contentKeys.list(params),
    queryFn: () => api.get<Paginated<Content>>('/contents', { ...params }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.items.some((c) => c.status === 'GENERATING') ? 3000 : false,
  });
}

export function useContent(id: string) {
  return useQuery({
    queryKey: contentKeys.one(id),
    queryFn: () => api.get<Content>(`/contents/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'GENERATING' ? 2500 : false),
  });
}

export function useGenerateContent(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: GenerateContentInput) =>
      api.post<{ jobId: string; contentId: string }>(`/topics/${topicId}/contents/generate`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contentKeys.all });
      void qc.invalidateQueries({ queryKey: ['ideas'] });
    },
  });
}

function useInvalidateContent(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: contentKeys.one(id) });
    void qc.invalidateQueries({ queryKey: ['contents', 'list'] });
  };
}

export function useReviseContent(id: string) {
  const invalidate = useInvalidateContent(id);
  return useMutation({
    mutationFn: (feedback: string) =>
      api.post<{ jobId: string }>(`/contents/${id}/revise`, { feedback }),
    onSuccess: invalidate,
  });
}

export function useEditContent(id: string) {
  const invalidate = useInvalidateContent(id);
  return useMutation({
    mutationFn: (data: EditContentVersionInput) =>
      api.put<Content>(`/contents/${id}/current`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateContent(id: string) {
  const invalidate = useInvalidateContent(id);
  return useMutation({
    mutationFn: (data: UpdateContentInput) => api.patch<Content>(`/contents/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useRestoreVersion(id: string) {
  const invalidate = useInvalidateContent(id);
  return useMutation({
    mutationFn: (versionId: string) =>
      api.post<Content>(`/contents/${id}/versions/${versionId}/restore`),
    onSuccess: invalidate,
  });
}

export function useDeleteContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/contents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.all }),
  });
}
