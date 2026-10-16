import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ProductivityStats } from '@contenter/shared';
import { api } from '@/lib/api-client';

export interface ProductivityParams {
  days: number;
  topicId?: string;
}

export function useProductivity(params: ProductivityParams) {
  return useQuery({
    queryKey: ['dashboard', 'productivity', params],
    queryFn: () =>
      api.get<ProductivityStats>('/dashboard/productivity', {
        days: params.days,
        ...(params.topicId ? { topicId: params.topicId } : {}),
      }),
    placeholderData: keepPreviousData,
  });
}
