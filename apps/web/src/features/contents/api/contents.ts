import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkContentMetricsInput,
  Content,
  ContentComment,
  ContentMetric,
  ContentMetricSummary,
  ContentStatus,
  CreateCommentInput,
  CreateContentMetricInput,
  EditContentVersionInput,
  GenerateContentInput,
  Paginated,
  RepurposeContentInput,
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

/** List parameters: plain strings and numbers (see `toApiParams`); lists are comma-separated. */
export function useContents(params: Record<string, string | number | undefined>) {
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
    refetchInterval: (q) =>
      q.state.data?.status === 'GENERATING' ||
      q.state.data?.repurposed?.some((r) => r.status === 'GENERATING')
        ? 2500
        : false,
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

// ---------- repurposing ----------

/** Writes the content again for other platforms; each target becomes a new content. */
export function useRepurpose(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RepurposeContentInput) =>
      api.post<{ items: { contentId: string; jobId: string; platform: string; format: string }[] }>(
        `/contents/${id}/repurpose`,
        data,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contentKeys.one(id) });
      void qc.invalidateQueries({ queryKey: ['contents', 'list'] });
    },
  });
}

// ---------- performance readings (docs/42) ----------

export const metricKeys = {
  content: (contentId: string) => ['content-metrics', contentId] as const,
};

export interface MetricsResponse {
  items: ContentMetric[];
  summary: ContentMetricSummary;
}

export function useMetrics(contentId: string, enabled = true) {
  return useQuery({
    queryKey: metricKeys.content(contentId),
    queryFn: () => api.get<MetricsResponse>(`/contents/${contentId}/metrics`),
    enabled,
  });
}

function useMetricMutation<T>(contentId: string, fn: (data: T) => Promise<MetricsResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => qc.setQueryData(metricKeys.content(contentId), data),
  });
}

export function useAddMetric(contentId: string) {
  return useMetricMutation(contentId, (data: CreateContentMetricInput) =>
    api.post<MetricsResponse>(`/contents/${contentId}/metrics`, data),
  );
}

export function useBulkMetrics(contentId: string) {
  return useMetricMutation(contentId, (data: BulkContentMetricsInput) =>
    api.post<MetricsResponse>(`/contents/${contentId}/metrics/bulk`, data),
  );
}

export function useDeleteMetric(contentId: string) {
  return useMetricMutation(contentId, (id: string) =>
    api.delete<MetricsResponse>(`/content-metrics/${id}`),
  );
}

/** Ticks or unticks one point of the publishing checklist (docs/45). */
export function useToggleChecklistItem(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, checked }: { itemId: string; checked: boolean }) =>
      api.put<void>(`/contents/${contentId}/checklist/${itemId}`, { checked }),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.one(contentId) }),
  });
}
