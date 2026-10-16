import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChecklistTemplate, SaveChecklistsInput } from '@contenter/shared';
import { api } from '@/lib/api-client';

const key = (businessId: string) => ['businesses', businessId, 'checklists'] as const;

export function useChecklists(businessId: string) {
  return useQuery({
    queryKey: key(businessId),
    queryFn: () => api.get<ChecklistTemplate[]>(`/businesses/${businessId}/checklists`),
  });
}

export function useSaveChecklists(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveChecklistsInput) =>
      api.put<ChecklistTemplate[]>(`/businesses/${businessId}/checklists`, data),
    onSuccess: (saved) => {
      qc.setQueryData(key(businessId), saved);
      // the checklist of every content of this business may have changed
      void qc.invalidateQueries({ queryKey: ['contents'] });
    },
  });
}
