import { create } from 'zustand';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
}

interface NotificationsState {
  notifications: Notification[];
  add: (n: Omit<Notification, 'id'>) => void;
  dismiss: (id: string) => void;
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  notifications: [],
  add: (n) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ notifications: [...s.notifications, { id, ...n }].slice(-5) }));
    setTimeout(() => get().dismiss(id), n.type === 'error' ? 8000 : 4500);
  },
  dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) })),
}));

/** Imperative helper usable outside React components (e.g. mutation callbacks). */
export const notify = {
  success: (title: string, message?: string) =>
    useNotifications.getState().add({ type: 'success', title, message }),
  error: (title: string, message?: string) =>
    useNotifications.getState().add({ type: 'error', title, message }),
  info: (title: string, message?: string) =>
    useNotifications.getState().add({ type: 'info', title, message }),
  warning: (title: string, message?: string) =>
    useNotifications.getState().add({ type: 'warning', title, message }),
};
