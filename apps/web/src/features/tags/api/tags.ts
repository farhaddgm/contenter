import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTagInput, SetTagsInput, Tag, UpdateTagInput } from '@contenter/shared';
import { api } from '@/lib/api-client';

export const tagKeys = {
  all: ['tags'] as const,
  topic: (topicId: string) => ['tags', topicId] as const,
};

/** The tags of one topic, with how many ideas and contents carry each. */
export function useTags(topicId: string | undefined) {
  return useQuery({
    queryKey: tagKeys.topic(topicId ?? ''),
    queryFn: () => api.get<Tag[]>(`/topics/${topicId}/tags`),
    enabled: !!topicId,
  });
}

/** Tags ride along ideas and contents, so any tag change refreshes all three lists. */
function useInvalidateTags() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: tagKeys.all });
    void qc.invalidateQueries({ queryKey: ['contents'] });
    void qc.invalidateQueries({ queryKey: ['ideas'] });
  };
}

export function useCreateTag(topicId: string) {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: (data: CreateTagInput) => api.post<Tag>(`/topics/${topicId}/tags`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateTag() {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTagInput }) =>
      api.patch<Tag>(`/tags/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteTag() {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tags/${id}`),
    onSuccess: invalidate,
  });
}

export function useSetContentTags(contentId: string) {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: (data: SetTagsInput) => api.put<Tag[]>(`/contents/${contentId}/tags`, data),
    onSuccess: invalidate,
  });
}

export function useSetIdeaTags(ideaId: string) {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: (data: SetTagsInput) => api.put<Tag[]>(`/ideas/${ideaId}/tags`, data),
    onSuccess: invalidate,
  });
}
