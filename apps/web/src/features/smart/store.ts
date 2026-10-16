import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WalkerStepKey } from '@contenter/shared';

export type SmartTab = 'walker' | 'chat' | 'errors';
/** Logical edge: `end` is the left edge in RTL and the right edge in LTR. */
export type SmartSide = 'start' | 'end';

export interface SmartToast {
  id: string;
  errorId: string;
  message: string;
  source: 'SERVER' | 'CLIENT' | 'AI_JOB';
}

interface SmartState {
  /** Header toggle: when off the floating window and Smart toasts disappear. */
  enabled: boolean;
  side: SmartSide;
  minimized: boolean;
  tab: SmartTab;
  walkerTopicId: string | null;
  walkerStep: WalkerStepKey;
  /** Active Walker assistant conversation. */
  conversationId: string | null;
  /** Error opened in the panel's error tab (and its conversation, if any). */
  selectedErrorId: string | null;
  toasts: SmartToast[];

  setEnabled: (v: boolean) => void;
  toggleSide: () => void;
  setMinimized: (v: boolean) => void;
  setTab: (t: SmartTab) => void;
  setWalkerTopic: (id: string | null) => void;
  setWalkerStep: (s: WalkerStepKey) => void;
  setConversationId: (id: string | null) => void;
  openError: (errorId: string | null) => void;
  pushToast: (t: Omit<SmartToast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useSmart = create<SmartState>()(
  persist(
    (set, get) => ({
      enabled: true,
      side: 'end',
      // starts as a small pill so it never covers the page on first visit
      minimized: true,
      tab: 'walker',
      walkerTopicId: null,
      walkerStep: 'select_topic',
      conversationId: null,
      selectedErrorId: null,
      toasts: [],

      setEnabled: (enabled) => set({ enabled }),
      toggleSide: () => set({ side: get().side === 'end' ? 'start' : 'end' }),
      setMinimized: (minimized) => set({ minimized }),
      setTab: (tab) => set({ tab }),
      setWalkerTopic: (walkerTopicId) =>
        set(
          walkerTopicId === get().walkerTopicId
            ? {}
            : { walkerTopicId, walkerStep: walkerTopicId ? 'describe_topic' : 'select_topic' },
        ),
      setWalkerStep: (walkerStep) => set({ walkerStep }),
      setConversationId: (conversationId) => set({ conversationId }),
      openError: (selectedErrorId) =>
        set({
          selectedErrorId,
          ...(selectedErrorId ? { enabled: true, minimized: false, tab: 'errors' as const } : {}),
        }),
      pushToast: (t) => {
        const id = Math.random().toString(36).slice(2);
        set({
          toasts: [...get().toasts.filter((x) => x.errorId !== t.errorId), { ...t, id }].slice(-4),
        });
        setTimeout(() => get().dismissToast(id), 9000);
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    }),
    {
      name: 'contenter-smart',
      version: 1,
      // v0 stored a physical edge (`left`/`right`); it is now logical (`end`/`start`)
      migrate: (state, version) => {
        const s = state as { side?: string };
        return version < 1 ? { ...s, side: s.side === 'right' ? 'start' : 'end' } : s;
      },
      partialize: (s) => ({
        enabled: s.enabled,
        side: s.side,
        minimized: s.minimized,
        tab: s.tab,
        walkerTopicId: s.walkerTopicId,
        walkerStep: s.walkerStep,
        conversationId: s.conversationId,
      }),
    },
  ),
);
