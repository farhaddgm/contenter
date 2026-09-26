/** Back-office API hooks: users, prompts, settings, audit, dashboard. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiSettings,
  AiSettingsResponse,
  AuditLog,
  ChangePasswordInput,
  CreatePromptVersionInput,
  CreateUserInput,
  DashboardStats,
  Paginated,
  PromptTemplate,
  UpdateUserInput,
  User,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

// ---------- dashboard ----------
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardStats>('/dashboard'),
    refetchInterval: 15_000,
  });
}

// ---------- users ----------
export function useUsers(params: { page: number; q?: string }) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => api.get<Paginated<User>>('/admin/users', params),
    placeholderData: keepPreviousData,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => api.post<User>('/admin/users', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      api.patch<User>(`/admin/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: ChangePasswordInput) => api.post<void>('/auth/change-password', data),
  });
}

// ---------- prompts ----------
export interface PromptKeySummary {
  key: string;
  notes: string;
  variables: string[];
  versions: number;
  activeVersion: number | null;
  updatedAt: string | null;
}

export function usePromptKeys() {
  return useQuery({
    queryKey: ['prompts'],
    queryFn: () => api.get<PromptKeySummary[]>('/admin/prompts'),
  });
}

export function usePromptVersions(key: string | null) {
  return useQuery({
    queryKey: ['prompts', key],
    queryFn: () => api.get<PromptTemplate[]>(`/admin/prompts/${key}/versions`),
    enabled: !!key,
  });
}

export function useCreatePromptVersion(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePromptVersionInput) =>
      api.post<PromptTemplate>(`/admin/prompts/${key}/versions`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
}

export function useActivatePrompt(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      api.put<PromptTemplate>(`/admin/prompts/${key}/versions/${version}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
}

// ---------- settings ----------
export function useAiSettings() {
  return useQuery({
    queryKey: ['settings', 'ai'],
    queryFn: () => api.get<AiSettingsResponse>('/admin/settings/ai'),
  });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AiSettings) => api.put<AiSettingsResponse>('/admin/settings/ai', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

// ---------- audit ----------
export function useAuditLogs(params: { page: number; q?: string; entityType?: string }) {
  return useQuery({
    queryKey: ['audit', params],
    queryFn: () => api.get<Paginated<AuditLog>>('/admin/audit-logs', params),
    placeholderData: keepPreviousData,
  });
}
