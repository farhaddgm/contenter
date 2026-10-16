import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKeyInfo, CreateApiKeyInput, CreatedApiKey } from '@contenter/shared';
import { api } from '@/lib/api-client';

const KEY = ['api-keys'] as const;

export function useApiKeys() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<ApiKeyInfo[]>('/api-keys') });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateApiKeyInput) => api.post<CreatedApiKey>('/api-keys', data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
