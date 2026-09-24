import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/errors/error-boundary';
import { MainErrorFallback } from '@/components/errors/main-error-fallback';
import { Notifications } from '@/components/ui/notifications';
import { isRtl } from '@/i18n';
import { AuthLoader } from '@/lib/auth';
import { createQueryClient } from '@/lib/react-query';
import { useUi } from '@/stores/ui';

/** Keeps <html> dir/lang and the dark class in sync with UI preferences. */
function DocumentSync() {
  const { theme, lang } = useUi();
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }, [lang]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      );
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ErrorBoundary fallback={<MainErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <DocumentSync />
        <Notifications />
        <AuthLoader>{children}</AuthLoader>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
