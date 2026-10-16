import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Same palettes as Bee Researcher. `light` is the neutral blue one; `system` = honey by day, dark by night. */
export const THEMES = [
  'system',
  'honey',
  'light',
  'dark',
  'forest',
  'slate',
  'blackyellow',
  'red',
] as const;
export type Theme = (typeof THEMES)[number];
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
      theme: 'honey',
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
      version: 1,
      // before v1 `light` meant the honey palette; the blue `light` palette is new
      migrate: (state, version) => {
        const s = state as { theme: Theme; lang: Lang; sidebarCollapsed: boolean };
        return version < 1 && s.theme === 'light' ? { ...s, theme: 'honey' as Theme } : s;
      },
      partialize: (s) => ({ theme: s.theme, lang: s.lang, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
