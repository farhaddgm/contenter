import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Notification,
  NotificationDelivery,
  NotificationEvent,
  NotificationPreferences,
  NotificationSettings,
  NotificationSettingsInput,
  Paginated,
  SetNotificationPreferenceInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const inboxKeys = {
  all: ['inbox'] as const,
  list: (p: object) => ['inbox', 'list', p] as const,
  unread: ['inbox', 'unread'] as const,
  preferences: ['inbox', 'preferences'] as const,
  settings: ['inbox', 'settings'] as const,
  deliveries: ['inbox', 'deliveries'] as const,
};

/** How often the bell asks for the unread count (it does not poll while the tab is hidden). */
const UNREAD_POLL_MS = 30_000;

export function useNotificationList(
  params: { page: number; unread?: boolean; pageSize?: number },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: () =>
      api.get<Paginated<Notification>>('/notifications', {
        page: params.page,
        pageSize: params.pageSize,
        unread: params.unread ? 'true' : undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: inboxKeys.unread,
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: UNREAD_POLL_MS,
    select: (d) => d.count,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: inboxKeys.all });
}

export function useMarkRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/notifications/${id}/read`),
    onSuccess: refresh,
  });
}

export function useMarkAllRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: refresh,
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: inboxKeys.preferences,
    queryFn: () => api.get<NotificationPreferences>('/notifications/preferences'),
  });
}

export function useSetNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      event,
      ...patch
    }: SetNotificationPreferenceInput & { event: NotificationEvent }) =>
      api.put<NotificationPreferences>(`/notifications/preferences/${event}`, patch),
    onSuccess: (data) => qc.setQueryData(inboxKeys.preferences, data),
  });
}

// ---------- admin ----------

export function useNotificationSettings() {
  return useQuery({
    queryKey: inboxKeys.settings,
    queryFn: () => api.get<NotificationSettings>('/admin/settings/notifications'),
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: NotificationSettingsInput) =>
      api.put<NotificationSettings>('/admin/settings/notifications', data),
    onSuccess: (data) => qc.setQueryData(inboxKeys.settings, data),
  });
}

export interface NotificationTestResult {
  email: 'sent' | 'skipped' | { error: string };
  webhook: 'sent' | 'skipped' | { error: string };
}

export function useSendNotificationTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<NotificationTestResult>('/admin/settings/notifications/test'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inboxKeys.deliveries }),
  });
}

export function useNotificationDeliveries() {
  return useQuery({
    queryKey: inboxKeys.deliveries,
    queryFn: () =>
      api.get<Paginated<NotificationDelivery>>('/admin/notification-deliveries', {
        page: 1,
        pageSize: 10,
      }),
  });
}
