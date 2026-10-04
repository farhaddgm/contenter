/** Back-office API hooks: users, prompts, settings, audit, dashboard. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiSettings,
  AiSettingsResponse,
  AuditLog,
  ChangePasswordInput,
  CreateGoogleAccessInput,
  CreatePromptVersionInput,
  CreateUserInput,
  DashboardStats,
  Paginated,
  PromptTemplate,
  SetAccessInput,
  UpdateGoogleAccessInput,
  UpdateUserInput,
  User,
  UserAccess,
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['google-access'] });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['google-access'] });
    },
  });
}

// ---------- topic / business access of a user (owner only, docs/17) ----------
export function useUserAccess(userId: string) {
  return useQuery({
    queryKey: ['user-access', userId],
    queryFn: () => api.get<UserAccess>(`/owner/users/${userId}/access`),
  });
}

export function useSetAccess(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      id,
      data,
    }: {
      kind: 'topics' | 'businesses';
      id: string;
      data: SetAccessInput;
    }) => api.put(`/owner/users/${userId}/${kind}/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-access', userId] }),
  });
}

// ---------- Gmail sign-in allowlist (owner only) ----------
export function useGoogleAccess() {
  return useQuery({
    queryKey: ['google-access'],
    queryFn: () => api.get<User[]>('/owner/google-access'),
  });
}

function useInvalidateAccess() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['google-access'] });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
}

export function useGrantGoogleAccess() {
  const invalidate = useInvalidateAccess();
  return useMutation({
    mutationFn: (data: CreateGoogleAccessInput) => api.post<User>('/owner/google-access', data),
    onSuccess: invalidate,
  });
}

export function useUpdateGoogleAccess() {
  const invalidate = useInvalidateAccess();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateGoogleAccessInput }) =>
      api.patch<User>(`/owner/google-access/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useRevokeGoogleAccess() {
  const invalidate = useInvalidateAccess();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/owner/google-access/${id}`),
    onSuccess: invalidate,
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
