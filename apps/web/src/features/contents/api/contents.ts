import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Content,
  ContentComment,
  ContentStatus,
  CreateCommentInput,
  EditContentVersionInput,
  GenerateContentInput,
  Paginated,
  ReviewAction,
  UpdateCommentInput,
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

// ---------- review workflow ----------

/** One step of the workflow; the server decides whether the caller may take it. */
export function useReviewAction(id: string) {
  const invalidate = useInvalidateContent(id);
  return useMutation({
    mutationFn: ({ action, note }: { action: ReviewAction; note?: string }) =>
      api.post<{ status: ContentStatus; reviewStage: string | null }>(
        `/contents/${id}/review/${action}`,
        { note },
      ),
    onSuccess: invalidate,
  });
}

// ---------- comments ----------

export const commentKeys = {
  all: ['comments'] as const,
  content: (contentId: string) => ['comments', contentId] as const,
};

export function useComments(contentId: string) {
  return useQuery({
    queryKey: commentKeys.content(contentId),
    queryFn: () => api.get<ContentComment[]>(`/contents/${contentId}/comments`),
  });
}

function useInvalidateComments(contentId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: commentKeys.content(contentId) });
}

export function useCreateComment(contentId: string) {
  const invalidate = useInvalidateComments(contentId);
  return useMutation({
    mutationFn: (data: CreateCommentInput) =>
      api.post<ContentComment>(`/contents/${contentId}/comments`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateComment(contentId: string) {
  const invalidate = useInvalidateComments(contentId);
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCommentInput }) =>
      api.patch<ContentComment>(`/comments/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteComment(contentId: string) {
  const invalidate = useInvalidateComments(contentId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/comments/${id}`),
    onSuccess: invalidate,
  });
}
