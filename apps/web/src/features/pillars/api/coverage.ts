import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContentPillar,
  CoverageBy,
  CoverageReport,
  OfferingCoverageReport,
  SavePillarsInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

const pillarsKey = (businessId: string) => ['businesses', businessId, 'pillars'] as const;

export function usePillars(businessId: string) {
  return useQuery({
    queryKey: pillarsKey(businessId),
    queryFn: () => api.get<ContentPillar[]>(`/businesses/${businessId}/pillars`),
  });
}

export function useSavePillars(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SavePillarsInput) =>
      api.put<ContentPillar[]>(`/businesses/${businessId}/pillars`, data),
    onSuccess: (saved) => {
      qc.setQueryData(pillarsKey(businessId), saved);
      void qc.invalidateQueries({ queryKey: ['businesses', businessId, 'coverage'] });
      // a content's pillar selector lists these
      void qc.invalidateQueries({ queryKey: ['topics'] });
      void qc.invalidateQueries({ queryKey: ['contents'] });
    },
  });
}

export interface CoverageParams {
  days: number;
  by: CoverageBy;
  staleDays: number;
}

/** Coverage of the catalog by content in the last 30 / 60 / 90 days, and the offering × audience matrix (docs/73). */
export function useOfferingCoverage(businessId: string, staleDays: number) {
  return useQuery({
    queryKey: ['businesses', businessId, 'offering-coverage', staleDays],
    queryFn: () =>
      api.get<OfferingCoverageReport>(`/businesses/${businessId}/offering-coverage`, { staleDays }),
    placeholderData: keepPreviousData,
  });
}

export function useCoverage(businessId: string, params: CoverageParams) {
  return useQuery({
    queryKey: ['businesses', businessId, 'coverage', params],
    queryFn: () => api.get<CoverageReport>(`/businesses/${businessId}/coverage`, { ...params }),
    placeholderData: keepPreviousData,
  });
}

/** The pillars a content of this topic can carry (its business's). */
export function useTopicPillars(topicId: string) {
  return useQuery({
    queryKey: ['topics', topicId, 'pillars'],
    queryFn: () => api.get<ContentPillar[]>(`/topics/${topicId}/pillars`),
  });
}
