import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptSuggestionInput,
  BuildBusinessInput,
  Business,
  BusinessDiscovery,
  BusinessSection,
  BusinessSectionKey,
  BusinessSectionRevision,
  BusinessStatus,
  BusinessSuggestion,
  CreateBusinessInput,
  DiscoverBusinessesInput,
  JobAccepted,
  Paginated,
  SuggestBusinessInput,
  UpdateBusinessInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const businessKeys = {
  all: ['businesses'] as const,
  list: (p: object) => ['businesses', 'list', p] as const,
  options: ['businesses', 'options'] as const,
  one: (id: string) => ['businesses', id] as const,
  suggestions: (id: string) => ['businesses', id, 'suggestions'] as const,
  revisions: (id: string, key: string) => ['businesses', id, 'revisions', key] as const,
  discoveries: ['business-discoveries'] as const,
  discovery: (id: string) => ['business-discoveries', id] as const,
};

export function useBusinesses(params: {
  page: number;
  q?: string;
  status?: BusinessStatus | '';
  pageSize?: number;
}) {
  return useQuery({
    queryKey: businessKeys.list(params),
    queryFn: () => api.get<Paginated<Business>>('/businesses', { ...params }),
    placeholderData: keepPreviousData,
  });
}

/** Every business, for pickers (topic form). */
export function useBusinessOptions() {
  return useQuery({
    queryKey: businessKeys.options,
    queryFn: () => api.get<Pick<Business, 'id' | 'name' | 'status'>[]>('/businesses/options'),
  });
}

export function useBusiness(id: string) {
  return useQuery({
    queryKey: businessKeys.one(id),
    queryFn: () => api.get<Business>(`/businesses/${id}`),
  });
}

function useInvalidateBusinesses() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: businessKeys.all });
    void qc.invalidateQueries({ queryKey: ['topics'] });
  };
}

export function useCreateBusiness() {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: (data: CreateBusinessInput) => api.post<Business>('/businesses', data),
    onSuccess: invalidate,
  });
}

export function useUpdateBusiness(id: string) {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: (data: UpdateBusinessInput) => api.patch<Business>(`/businesses/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteBusiness() {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/businesses/${id}`),
    onSuccess: invalidate,
  });
}

// ---------- sections ----------

export function useUpdateSection(businessId: string) {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: ({ key, content }: { key: BusinessSectionKey; content: string }) =>
      api.put<BusinessSection>(`/businesses/${businessId}/sections/${key}`, { content }),
    onSuccess: invalidate,
  });
}

export function useSectionRevisions(businessId: string, key: BusinessSectionKey) {
  return useQuery({
    queryKey: businessKeys.revisions(businessId, key),
    queryFn: () =>
      api.get<BusinessSectionRevision[]>(`/businesses/${businessId}/sections/${key}/revisions`),
  });
}

export function useRestoreRevision() {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: (revisionId: string) =>
      api.post<BusinessSection>(`/business-revisions/${revisionId}/restore`),
    onSuccess: invalidate,
  });
}

// ---------- AI ----------

export function useSuggestions(businessId: string) {
  return useQuery({
    queryKey: businessKeys.suggestions(businessId),
    queryFn: () => api.get<BusinessSuggestion[]>(`/businesses/${businessId}/suggestions`),
  });
}

export function useSuggest(businessId: string) {
  return useMutation({
    mutationFn: (data: SuggestBusinessInput) =>
      api.post<JobAccepted & { keys: BusinessSectionKey[] }>(
        `/businesses/${businessId}/suggest`,
        data,
      ),
  });
}

export function useAcceptSuggestion() {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AcceptSuggestionInput }) =>
      api.post<BusinessSection>(`/business-suggestions/${id}/accept`, data),
    onSuccess: invalidate,
  });
}

export function useDismissSuggestion() {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: (id: string) => api.post(`/business-suggestions/${id}/dismiss`),
    onSuccess: invalidate,
  });
}

export function useBuildBusiness(businessId: string) {
  const invalidate = useInvalidateBusinesses();
  return useMutation({
    mutationFn: (data: BuildBusinessInput) =>
      api.post<JobAccepted>(`/businesses/${businessId}/build`, data),
    onSuccess: invalidate,
  });
}

// ---------- keyword discovery ----------

export function useDiscoveries() {
  return useQuery({
    queryKey: businessKeys.discoveries,
    queryFn: () => api.get<BusinessDiscovery[]>('/business-discoveries'),
  });
}

export function useDiscovery(id: string) {
  return useQuery({
    queryKey: businessKeys.discovery(id),
    queryFn: () => api.get<BusinessDiscovery>(`/business-discoveries/${id}`),
  });
}

export function useDiscover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: DiscoverBusinessesInput) =>
      api.post<{ id: string; jobId: string }>('/business-discoveries', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: businessKeys.discoveries }),
  });
}

export function useSelectCandidate(discoveryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (index: number) =>
      api.post<JobAccepted & { businessId: string }>(
        `/business-discoveries/${discoveryId}/select`,
        { index },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: businessKeys.discoveries });
      void qc.invalidateQueries({ queryKey: businessKeys.all });
    },
  });
}
