import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Lightbulb, ScanSearch, Sparkles, Wand2 } from 'lucide-react';
import { LoginSchema, type LoginInput } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useLogin, useUser } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';

export default function LoginRoute() {
  const t = useT();
  const user = useUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useLogin();
  const redirectTo = params.get('redirectTo') || paths.app.dashboard.getHref();

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  if (user) return <Navigate to={redirectTo} replace />;

  const features = [
    { icon: <ScanSearch />, text: t('topics.steps.analyze') },
    { icon: <Wand2 />, text: t('topics.steps.profile') },
    { icon: <Lightbulb />, text: t('topics.steps.ideas') },
    { icon: <Sparkles />, text: t('topics.steps.contents') },
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -end-24 -top-24 size-96 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="absolute -bottom-32 -start-16 size-96 rounded-full bg-purple-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-10" />
          <span className="text-xl font-bold">{t('app.name')}</span>
        </div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl font-bold leading-snug">{t('auth.heroTitle')}</h2>
          <p className="leading-8 text-sidebar-foreground">{t('auth.heroBody')}</p>
          <ul className="space-y-3">
            {features.map((f, i) => (
              <li
                key={i}
                className="flex items-center gap-3 text-sm text-sidebar-foreground [&_svg]:size-4"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white">
                  {f.icon}
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">
          © {new Date().getFullYear()} Contenter
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center">
            <img src="/logo.svg" alt="" className="mx-auto size-12 lg:hidden" />
            <h1 className="text-2xl font-bold">{t('auth.loginTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
          </div>
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
                  autoComplete="current-password"
                  {...form.register('password')}
                />
              )}
            </Field>
            {login.error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
        </div>
      </div>
    </div>
  );
}
