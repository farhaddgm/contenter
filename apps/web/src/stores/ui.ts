import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type Lang = 'fa' | 'en';

interface UiState {
  theme: Theme;
  lang: Lang;
  sidebarOpen: boolean;
  /** Desktop sidebar shows icons only. */
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  setLang: (l: Lang) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: 'fa',
      sidebarOpen: false,
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    {
      name: 'contenter-ui',
      partialize: (s) => ({ theme: s.theme, lang: s.lang, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
