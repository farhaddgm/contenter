import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityItem,
  AppError,
  ConversationKind,
  ErrorSource,
  ErrorStatus,
  InteractionLog,
  IssueStatus,
  Paginated,
  SendSmartMessageInput,
  SmartConfig,
  SmartConversation,
  SmartSettings,
  StartConversationInput,
  UpdateIssueInput,
  WalkerIssue,
  WalkerProgress,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const smartKeys = {
  all: ['smart'] as const,
  config: ['smart', 'config'] as const,
  settings: ['smart', 'settings'] as const,
  summary: ['smart', 'summary'] as const,
  progress: (topicId: string | null) => ['smart', 'progress', topicId ?? 'none'] as const,
  activity: ['smart', 'activity'] as const,
  errors: (p: object) => ['smart', 'errors', p] as const,
  error: (id: string) => ['smart', 'error', id] as const,
  conversations: (p: object) => ['smart', 'conversations', p] as const,
  conversation: (id: string) => ['smart', 'conversation', id] as const,
  issues: (p: object) => ['smart', 'issues', p] as const,
  interactions: (p: object) => ['smart', 'interactions', p] as const,
};

// ---------- config & settings ----------
export function useSmartConfig(enabled = true) {
  return useQuery({
    queryKey: smartKeys.config,
    queryFn: () => api.get<SmartConfig>('/smart/config'),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useSmartSettings() {
  return useQuery({
    queryKey: smartKeys.settings,
    queryFn: () => api.get<SmartSettings>('/smart/settings'),
  });
}

export function useUpdateSmartSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SmartSettings) => api.put<SmartSettings>('/smart/settings', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: smartKeys.settings });
      void qc.invalidateQueries({ queryKey: smartKeys.config });
    },
  });
}

export function useSmartSummary(enabled: boolean) {
  return useQuery({
    queryKey: smartKeys.summary,
    queryFn: () => api.get<{ openErrors: number; openIssues: number }>('/smart/summary'),
    enabled,
    refetchInterval: 30_000,
  });
}

// ---------- walker ----------
export function useWalkerProgress(topicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: smartKeys.progress(topicId),
    queryFn: () => api.get<WalkerProgress>('/smart/walker/progress', { topicId }),
    enabled,
    refetchInterval: 5_000,
    staleTime: 0,
  });
}

export function useSmartActivity(enabled: boolean) {
  return useQuery({
    queryKey: smartKeys.activity,
    queryFn: () => api.get<ActivityItem[]>('/smart/activity', { limit: 15 }),
    enabled,
    refetchInterval: 10_000,
  });
}

// ---------- errors ----------
export function useSmartErrors(
  params: {
    page: number;
    status?: ErrorStatus | '';
    source?: ErrorSource | '';
    q?: string;
    pageSize?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: smartKeys.errors(params),
    queryFn: () => api.get<Paginated<AppError>>('/smart/errors', { ...params }),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: 15_000,
  });
}

export function useSmartError(id: string | null) {
  return useQuery({
    queryKey: smartKeys.error(id ?? ''),
    queryFn: () => api.get<AppError>(`/smart/errors/${id}`),
    enabled: !!id,
  });
}

export function fetchErrorFeed(since: string) {
  return api.get<AppError[]>('/smart/errors/feed', { since });
}

export function useUpdateErrorStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ErrorStatus }) =>
      api.patch<AppError>(`/smart/errors/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: smartKeys.all }),
  });
}

// ---------- conversations ----------
export function useConversations(
  params: { kind?: ConversationKind; errorId?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: smartKeys.conversations(params),
    queryFn: () => api.get<SmartConversation[]>('/smart/conversations', params),
    enabled,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: smartKeys.conversation(id ?? ''),
    queryFn: () => api.get<SmartConversation>(`/smart/conversations/${id}`),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data?.messages?.some((m) => m.status === 'PENDING') ? 1500 : false,
    retry: false,
  });
}

export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: StartConversationInput) =>
      api.post<SmartConversation>('/smart/conversations', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart', 'conversations'] }),
  });
}

export function useSendSmartMessage(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SendSmartMessageInput) =>
      api.post<{ jobId: string; messageId: string }>(
        `/smart/conversations/${conversationId}/messages`,
        data,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: smartKeys.conversation(conversationId ?? '') }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/smart/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart', 'conversations'] }),
  });
}

// ---------- walker issue log ----------
export function useSaveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.post<WalkerIssue>('/smart/issues', { messageId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['smart', 'conversation'] });
      void qc.invalidateQueries({ queryKey: ['smart', 'issues'] });
      void qc.invalidateQueries({ queryKey: smartKeys.summary });
    },
  });
}

export function useIssues(params: { page: number; status?: IssueStatus | ''; q?: string }) {
  return useQuery({
    queryKey: smartKeys.issues(params),
    queryFn: () => api.get<Paginated<WalkerIssue>>('/smart/issues', { ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIssueInput }) =>
      api.patch<WalkerIssue>(`/smart/issues/${id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['smart', 'issues'] });
      void qc.invalidateQueries({ queryKey: smartKeys.summary });
    },
  });
}

export function useDeleteIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/smart/issues/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['smart', 'issues'] });
      void qc.invalidateQueries({ queryKey: smartKeys.summary });
    },
  });
}

// ---------- interaction logs ----------
export function useInteractions(params: { page: number; type?: string; q?: string }) {
  return useQuery({
    queryKey: smartKeys.interactions(params),
    queryFn: () => api.get<Paginated<InteractionLog>>('/smart/interactions', { ...params }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
}
