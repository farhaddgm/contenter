import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { ChangePasswordSchema, type ChangePasswordInput } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth';
import { notify } from '@/stores/notifications';
import { formatDate } from '@/utils/format';
import { useChangePassword } from '@/features/admin/api';

export default function AccountRoute() {
  const t = useT();
  const user = useUser();
  const navigate = useNavigate();
  const change = useChangePassword();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  if (!user) return null;

  return (
    <>
      <PageHeader title={t('account.title')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('account.profile')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('users.name')}</dt>
                <dd>{user.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('users.email')}</dt>
                <dd dir="ltr">{user.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('users.role')}</dt>
                <dd>
                  <Badge tone="primary">{t(`enums.role.${user.role}`)}</Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('users.loginMethod')}</dt>
                <dd>{t(`enums.loginMethod.${user.loginMethod}`)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('users.lastLogin')}</dt>
                <dd>{formatDate(user.lastLoginAt)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('auth.changePassword')} />
          <CardBody>
            {user.hasPassword && user.loginMethod !== 'GOOGLE' ? (
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit((values) =>
                  change.mutate(values, {
                    onSuccess: () => {
                      notify.success(t('auth.passwordChanged'));
                      useAuthStore.getState().clear();
                      navigate(paths.auth.login.getHref());
                    },
                    onError: (e) => notify.error(t('common.error'), e.message),
                  }),
                )}
              >
                <Field
                  label={t('auth.currentPassword')}
                  error={form.formState.errors.currentPassword?.message}
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      dir="ltr"
                      autoComplete="current-password"
                      {...form.register('currentPassword')}
                    />
                  )}
                </Field>
                <Field
                  label={t('auth.newPassword')}
                  error={form.formState.errors.newPassword?.message}
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      dir="ltr"
                      autoComplete="new-password"
                      {...form.register('newPassword')}
                    />
                  )}
                </Field>
                <Button type="submit" isLoading={change.isPending}>
                  {t('common.save')}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">{t('auth.googleOnlyHint')}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
