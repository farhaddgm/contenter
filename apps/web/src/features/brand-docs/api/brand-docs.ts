import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BrandDocument,
  CreateBrandDocInput,
  TopicAiContext,
  UpdateBrandDocInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const brandDocKeys = {
  all: ['brand-docs'] as const,
  list: (topicId: string) => ['brand-docs', 'topic', topicId] as const,
  one: (id: string) => ['brand-docs', id] as const,
  /** Under ['topics'] so profile/topic invalidations refresh it too. */
  aiContext: (topicId: string) => ['topics', topicId, 'ai-context'] as const,
};

export function useBrandDocs(topicId: string) {
  return useQuery({
    queryKey: brandDocKeys.list(topicId),
    queryFn: () => api.get<BrandDocument[]>(`/topics/${topicId}/brand-docs`),
  });
}

/** Full document including its text (the list omits it). */
export function useBrandDoc(id: string | undefined) {
  return useQuery({
    queryKey: brandDocKeys.one(id ?? ''),
    queryFn: () => api.get<BrandDocument>(`/brand-docs/${id}`),
    enabled: !!id,
  });
}

export function useTopicAiContext(topicId: string) {
  return useQuery({
    queryKey: brandDocKeys.aiContext(topicId),
    queryFn: () => api.get<TopicAiContext>(`/topics/${topicId}/ai-context`),
  });
}

function useInvalidateBrandDocs() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: brandDocKeys.all });
    void qc.invalidateQueries({ queryKey: ['topics'] });
  };
}

export function useCreateBrandDoc(topicId: string) {
  const invalidate = useInvalidateBrandDocs();
  return useMutation({
    mutationFn: (data: CreateBrandDocInput) =>
      api.post<BrandDocument>(`/topics/${topicId}/brand-docs`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateBrandDoc() {
  const invalidate = useInvalidateBrandDocs();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBrandDocInput }) =>
      api.patch<BrandDocument>(`/brand-docs/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteBrandDoc() {
  const invalidate = useInvalidateBrandDocs();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/brand-docs/${id}`),
    onSuccess: invalidate,
  });
}
