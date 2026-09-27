import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AuthProviders, AuthResponse, LoginInput, Role } from '@contenter/shared';
import { env } from '@/config/env';
import { paths } from '@/config/paths';
import { PageSpinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/stores/auth';
import { api, refreshSession } from './api-client';

export const useUser = () => useAuthStore((s) => s.user);

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (data: LoginInput) => api.post<AuthResponse>('/auth/login', data),
    onSuccess: (res) => setSession(res.accessToken, res.user),
  });
}

/** Which sign-in methods the server offers (the Google button shows only when configured). */
export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.get<AuthProviders>('/auth/providers'),
    staleTime: Infinity,
  });
}

/** Full-page navigation: the API redirects to Google and back, then sets the session cookie. */
export const googleSignInUrl = (redirectTo: string) =>
  `${env.API_URL}/auth/google?redirectTo=${encodeURIComponent(redirectTo)}`;

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => clear(),
  });
}

/** Restores the session from the refresh cookie once on app start. */
export function AuthLoader({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const markReady = useAuthStore((s) => s.markReady);
  useEffect(() => {
    if (status === 'idle') void refreshSession().finally(markReady);
  }, [status, markReady]);
  if (status === 'idle') return <PageSpinner />;
  return <>{children}</>;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useUser();
  const location = useLocation();
  if (!user) return <Navigate to={paths.auth.login.getHref(location.pathname)} replace />;
  return <>{children}</>;
}

// ---------- authorization (RBAC) ----------

export const POLICIES = {
  'content:write': (role: Role) => role === 'ADMIN' || role === 'EDITOR',
  'backoffice:access': (role: Role) => role === 'ADMIN',
  'topic:delete': (role: Role) => role === 'ADMIN',
  'business:delete': (role: Role) => role === 'ADMIN',
} as const;

export type Policy = keyof typeof POLICIES;

export function useAuthorization() {
  const user = useUser();
  const can = (policy: Policy) => !!user && POLICIES[policy](user.role);
  return { user, can, role: user?.role };
}

/** Renders children only when the current user satisfies the policy. */
export function Authorization({
  policy,
  children,
  fallback = null,
}: {
  policy: Policy;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuthorization();
  return <>{can(policy) ? children : fallback}</>;
}
