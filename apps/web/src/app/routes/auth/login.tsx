import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { GoogleLoginError, LoginSchema, type LoginInput } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { googleSignInUrl, useAuthProviders, useLogin, useUser } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useUi, type Lang } from '@/stores/ui';
import { cn } from '@/utils/cn';

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
  const { lang, setLang } = useUi();
  const providers = useAuthProviders();
  const googleError = GoogleLoginError.find((code) => code === params.get('error'));
  const redirectTo = params.get('redirectTo') || paths.app.dashboard.getHref();

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  useNoIndex(withPassword);

  if (user) return <Navigate to={redirectTo} replace />;

  const inputClass =
    'h-[2.875rem] rounded-xl bg-card px-3.5 text-start placeholder:text-start rtl:placeholder:text-right';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_20%_0,color-mix(in_oklch,var(--ring)_38%,var(--background))_0,var(--background)_44%)] p-6">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-[28.75rem] rounded-[1.75rem] border bg-card/95 p-8 shadow-[0_16px_42px_color-mix(in_oklch,var(--sidebar)_16%,transparent)] sm:p-10"
      >
        <div className="mb-2 flex min-h-[8rem] items-center justify-center">
          <img src="/logo-full.svg" alt={t('app.name')} className="h-auto w-full max-w-[21rem]" />
        </div>
        <h1 id="login-title" className="sr-only">
          {t('auth.loginTitle')}
        </h1>
        {/* Always shown on the Google-only page; an unconfigured server answers ?error=not_configured. */}
        {(!withPassword || providers.data?.google) && (
          <Button
            asChild
            size="lg"
            className="mt-4 h-[2.875rem] w-full rounded-xl text-[0.9375rem]"
          >
            <a href={googleSignInUrl(redirectTo)}>
              <GoogleIcon />
              {t('auth.withGoogle')}
            </a>
          </Button>
        )}
        {googleError && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive">
            {t(`auth.googleErrors.${googleError}`)}
          </p>
        )}
        {withPassword && (
          <form
            noValidate
            className="mt-1"
            onSubmit={form.handleSubmit((values) =>
              login.mutate(values, { onSuccess: () => navigate(redirectTo, { replace: true }) }),
            )}
          >
            <Input
              dir="ltr"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder={t('auth.email')}
              aria-label={t('auth.email')}
              aria-invalid={!!form.formState.errors.email}
              aria-describedby="login-email-error"
              className={cn(inputClass, 'mt-3')}
              {...form.register('email')}
            />
            <p
              id="login-email-error"
              role="alert"
              className="mx-0.5 mt-1.5 min-h-[1.125rem] text-xs text-destructive"
            >
              {form.formState.errors.email?.message}
            </p>
            <Input
              dir="ltr"
              type="password"
              autoComplete="current-password"
              placeholder={t('auth.password')}
              aria-label={t('auth.password')}
              aria-invalid={!!form.formState.errors.password}
              aria-describedby="login-password-error"
              className={inputClass}
              {...form.register('password')}
            />
            <p
              id="login-password-error"
              role="alert"
              className="mx-0.5 mt-1.5 min-h-[1.125rem] text-xs text-destructive"
            >
              {form.formState.errors.password?.message}
            </p>
            <Button
              type="submit"
              size="lg"
              className="mt-3 h-[2.875rem] w-full rounded-xl text-[0.9375rem] font-bold"
              isLoading={login.isPending}
            >
              {t('auth.login')}
            </Button>
            {login.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {login.error instanceof ApiError && login.error.status === 401
                  ? t('auth.loginFailed')
                  : login.error.message}
              </p>
            )}
          </form>
        )}
        <label
          dir="ltr"
          className="mt-[1.125rem] flex w-full items-center justify-center rounded-[0.6875rem] border bg-muted p-[0.1875rem]"
        >
          <span className="sr-only">{t('nav.language')}</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            aria-label={t('nav.language')}
            className="h-[2.375rem] w-full cursor-pointer rounded-lg bg-card px-3 text-center text-xs font-bold text-primary"
          >
            <option value="fa">فارسی</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>
    </main>
  );
}

export default function LoginRoute() {
  return <LoginPage />;
}
