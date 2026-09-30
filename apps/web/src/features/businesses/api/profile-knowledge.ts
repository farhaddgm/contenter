import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BusinessAudit,
  BusinessFact,
  BusinessSection,
  BusinessSectionKey,
  BusinessTerm,
  CreateBusinessFactInput,
  CreateBusinessTermInput,
  FixAuditIssueInput,
  JobAccepted,
  UpdateBusinessFactInput,
  UpdateBusinessTermInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';
import { businessKeys } from './businesses';

/** Section review, key facts, terminology and the AI profile audit (docs/16). */
export const knowledgeKeys = {
  facts: (id: string) => [...businessKeys.one(id), 'facts'] as const,
  terms: (id: string) => [...businessKeys.one(id), 'terms'] as const,
  audit: (id: string) => [...businessKeys.one(id), 'audit'] as const,
};

/** Everything under the business (profile, facts, terms, audit, notes, suggestions). */
function useInvalidateBusiness(businessId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: businessKeys.one(businessId) });
}

export function useReviewSection(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: (key: BusinessSectionKey) =>
      api.post<BusinessSection>(`/businesses/${businessId}/sections/${key}/review`),
    onSuccess: invalidate,
  });
}

// ---------- facts ----------

export function useFacts(businessId: string) {
  return useQuery({
    queryKey: knowledgeKeys.facts(businessId),
    queryFn: () => api.get<BusinessFact[]>(`/businesses/${businessId}/facts`),
  });
}

export function useCreateFact(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: (data: CreateBusinessFactInput) =>
      api.post<BusinessFact>(`/businesses/${businessId}/facts`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateFact(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBusinessFactInput }) =>
      api.patch<BusinessFact>(`/business-facts/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteFact(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/business-facts/${id}`),
    onSuccess: invalidate,
  });
}

// ---------- terms ----------

export function useTerms(businessId: string) {
  return useQuery({
    queryKey: knowledgeKeys.terms(businessId),
    queryFn: () => api.get<BusinessTerm[]>(`/businesses/${businessId}/terms`),
  });
}

export function useCreateTerm(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: (data: CreateBusinessTermInput) =>
      api.post<BusinessTerm>(`/businesses/${businessId}/terms`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateTerm(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBusinessTermInput }) =>
      api.patch<BusinessTerm>(`/business-terms/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteTerm(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/business-terms/${id}`),
    onSuccess: invalidate,
  });
}

// ---------- audit ----------

export function useAudit(businessId: string) {
  return useQuery({
    queryKey: knowledgeKeys.audit(businessId),
    queryFn: () => api.get<BusinessAudit | null>(`/businesses/${businessId}/audit`),
  });
}

export function useStartAudit(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: () => api.post<JobAccepted & { id: string }>(`/businesses/${businessId}/audit`),
    onSuccess: invalidate,
  });
}

export function useFixAuditIssue(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: ({
      auditId,
      index,
      data,
    }: {
      auditId: string;
      index: number;
      data: FixAuditIssueInput;
    }) =>
      api.post<JobAccepted & { id: string }>(
        `/business-audits/${auditId}/issues/${index}/fix`,
        data,
      ),
    onSuccess: invalidate,
  });
}

export function useDismissAuditIssue(businessId: string) {
  const invalidate = useInvalidateBusiness(businessId);
  return useMutation({
    mutationFn: ({ auditId, index }: { auditId: string; index: number }) =>
      api.post<BusinessAudit>(`/business-audits/${auditId}/issues/${index}/dismiss`),
    onSuccess: invalidate,
  });
}
