import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Lightbulb, ScanSearch, Sparkles, Wand2 } from 'lucide-react';
import { GoogleLoginError, LoginSchema, type LoginInput } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { googleSignInUrl, useAuthProviders, useLogin, useUser } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** Keeps a page out of search engines while it is mounted (nginx also sends X-Robots-Tag). */
function useNoIndex(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [enabled]);
}

/**
 * `/auth/login` is Google-only. `/auth/login-up` (unlinked, noindex) also offers email + password;
 * nothing in the app links to it — it is reached only by typing the address.
 */
export function LoginPage({ withPassword = false }: { withPassword?: boolean }) {
  const t = useT();
  const user = useUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useLogin();
  const providers = useAuthProviders();
  const googleError = GoogleLoginError.find((code) => code === params.get('error'));
  const redirectTo = params.get('redirectTo') || paths.app.dashboard.getHref();

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  useNoIndex(withPassword);

  if (user) return <Navigate to={redirectTo} replace />;

  const features = [
    { icon: <ScanSearch />, text: t('topics.steps.analyze') },
    { icon: <Wand2 />, text: t('topics.steps.profile') },
    { icon: <Lightbulb />, text: t('topics.steps.ideas') },
    { icon: <Sparkles />, text: t('topics.steps.contents') },
  ];

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-[radial-gradient(circle_at_20%_0,#f4d28c_0,var(--background)_46%)] p-4 py-10 dark:bg-[radial-gradient(circle_at_20%_0,#4a2c10_0,var(--background)_50%)]">
      <div className="w-full max-w-[28.75rem] space-y-7 rounded-[1.75rem] border bg-card/95 p-8 shadow-[0_16px_42px_rgb(122_75_14/0.14)] sm:p-10">
        <div className="space-y-3 text-center">
          <img src="/logo.svg" alt="" className="mx-auto size-16 rounded-2xl shadow-md" />
          <p className="text-xl font-extrabold" dir="ltr">
            {t('app.name')}
          </p>
          <h1 className="pt-2 text-2xl font-extrabold">{t('auth.loginTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
        </div>
        {withPassword && (
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) =>
              login.mutate(values, { onSuccess: () => navigate(redirectTo, { replace: true }) }),
            )}
          >
            <Field label={t('auth.email')} error={form.formState.errors.email?.message}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  dir="ltr"
                  className="h-11 text-start"
                  autoComplete="email"
                  autoFocus
                  {...form.register('email')}
                />
              )}
            </Field>
            <Field label={t('auth.password')} error={form.formState.errors.password?.message}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  dir="ltr"
                  className="h-11 text-start"
                  autoComplete="current-password"
                  {...form.register('password')}
                />
              )}
            </Field>
            {login.error && (
              <p
                role="alert"
                className="rounded-control bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
              >
                {login.error instanceof ApiError && login.error.status === 401
                  ? t('auth.loginFailed')
                  : login.error.message}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" isLoading={login.isPending}>
              {t('auth.login')}
            </Button>
          </form>
        )}
        {googleError && (
          <p
            role="alert"
            className="rounded-control bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
          >
            {t(`auth.googleErrors.${googleError}`)}
          </p>
        )}
        {withPassword && providers.data?.google && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {/* Always shown on the Google-only page; an unconfigured server answers ?error=not_configured. */}
        {(!withPassword || providers.data?.google) && (
          <Button
            asChild
            variant={withPassword ? 'outline' : 'default'}
            size="lg"
            className="w-full"
          >
            <a href={googleSignInUrl(redirectTo)}>
              <GoogleIcon />
              {t('auth.withGoogle')}
            </a>
          </Button>
        )}
      </div>
      <ul className="flex max-w-3xl flex-wrap justify-center gap-2.5">
        {features.map((f, i) => (
          <li
            key={i}
            className="flex items-center gap-2 rounded-full border bg-card/80 px-3.5 py-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5 [&_svg]:text-primary"
          >
            {f.icon}
            {f.text}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Contenter</p>
    </main>
  );
}

export default function LoginRoute() {
  return <LoginPage />;
}
