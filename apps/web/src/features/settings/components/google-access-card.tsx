import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Crown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  CreateGoogleAccessSchema,
  GoogleLoginMethod,
  Role,
  UpdateGoogleAccessSchema,
  type CreateGoogleAccessInput,
  type UpdateGoogleAccessInput,
  type User,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import {
  useGoogleAccess,
  useGrantGoogleAccess,
  useRevokeGoogleAccess,
  useUpdateGoogleAccess,
} from '@/features/admin/api';

type FormValues = CreateGoogleAccessInput & UpdateGoogleAccessInput;

/** Add / edit one Gmail on the allowlist. Mounted only while open, so defaults need no reset. */
function GoogleAccessDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const t = useT();
  const grant = useGrantGoogleAccess();
  const update = useUpdateGoogleAccess();
  const form = useForm<FormValues>({
    resolver: zodResolver(user ? UpdateGoogleAccessSchema : CreateGoogleAccessSchema) as never,
    defaultValues: user
      ? {
          name: user.name,
          role: user.role,
          isActive: user.isActive,
          loginMethod: user.loginMethod === 'BOTH' ? 'BOTH' : 'GOOGLE',
        }
      : { email: '', name: '', role: 'EDITOR', loginMethod: 'GOOGLE' },
  });
  const [method, isActive] = useWatch({ control: form.control, name: ['loginMethod', 'isActive'] });
  const needsPassword = method === 'BOTH' && !user?.hasPassword;
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    if (needsPassword && !values.password) {
      form.setError('password', { message: t('googleAccess.passwordRequired') });
      return;
    }
    const password = values.loginMethod === 'BOTH' && values.password ? values.password : undefined;
    const done = {
      onSuccess: () => {
        notify.success(user ? t('common.saved') : t('googleAccess.granted'));
        onClose();
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (user) {
      const { name, role, isActive: active, loginMethod } = values;
      update.mutate(
        { id: user.id, data: { name, role, isActive: active, loginMethod, password } },
        done,
      );
    } else {
      const { email, name, role, loginMethod } = values;
      grant.mutate({ email, name, role, loginMethod, password }, done);
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={user ? t('googleAccess.editTitle') : t('googleAccess.add')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="google-access-form"
            isLoading={grant.isPending || update.isPending}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="google-access-form" onSubmit={onSubmit} className="space-y-4">
        {user ? (
          <p className="text-sm text-muted-foreground" dir="ltr">
            {user.email}
          </p>
        ) : (
          <Field
            label={t('googleAccess.email')}
            hint={t('googleAccess.emailHint')}
            error={errors.email?.message}
          >
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                type="email"
                placeholder="name@gmail.com"
                autoFocus
                {...form.register('email')}
              />
            )}
          </Field>
        )}
        <Field label={t('users.name')} error={errors.name?.message}>
          {(id) => <Input id={id} {...form.register('name')} />}
        </Field>
        <Field label={t('users.role')}>
          {(id) => (
            <Select
              id={id}
              options={Role.map((r) => ({ value: r, label: t(`enums.role.${r}`) }))}
              {...form.register('role')}
            />
          )}
        </Field>
        <Field label={t('googleAccess.method')} hint={t(`googleAccess.methodHint.${method}`)}>
          {() => (
            <div>
              <Segmented
                value={method}
                onChange={(v) => form.setValue('loginMethod', v)}
                options={GoogleLoginMethod.map((m) => ({
                  value: m,
                  label: t(`enums.loginMethod.${m}`),
                }))}
              />
            </div>
          )}
        </Field>
        {method === 'BOTH' && (
          <Field
            label={t('googleAccess.password')}
            hint={needsPassword ? undefined : t('googleAccess.passwordKeep')}
            error={errors.password?.message}
          >
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                type="password"
                autoComplete="new-password"
                {...form.register('password', { setValueAs: (v) => v || undefined })}
              />
            )}
          </Field>
        )}
        {user && (
          <Switch
            checked={!!isActive}
            onCheckedChange={(v) => form.setValue('isActive', v)}
            label={t('users.active')}
          />
        )}
      </form>
    </Dialog>
  );
}

/** Owner-only: which Gmail accounts may use "Sign in with Google", and how each signs in. */
export function GoogleAccessCard() {
  const t = useT();
  const me = useUser();
  const { data, isLoading } = useGoogleAccess();
  const revoke = useRevokeGoogleAccess();
  const [dialog, setDialog] = useState<{ user: User | null } | null>(null);

  return (
    <Card>
      <CardHeader
        title={t('googleAccess.title')}
        description={t('googleAccess.description')}
        actions={
          <Button size="sm" icon={<Plus />} onClick={() => setDialog({ user: null })}>
            {t('googleAccess.add')}
          </Button>
        }
      />
      <CardBody className="p-0">
        <ul className="divide-y">
          {me && (
            <li className="flex items-center gap-3 px-5 py-3">
              <Crown className="size-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" dir="ltr">
                  {me.email}
                </p>
                <p className="text-xs text-muted-foreground">{t('googleAccess.owner')}</p>
              </div>
              <Badge tone="primary">{t('users.owner')}</Badge>
            </li>
          )}
          {isLoading && (
            <li className="flex justify-center p-6">
              <Spinner />
            </li>
          )}
          {data?.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-muted-foreground">
              {t('googleAccess.empty')}
            </li>
          )}
          {data?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.name}</p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {u.email}
                </p>
              </div>
              <Badge tone="outline">{t(`enums.role.${u.role}`)}</Badge>
              <Badge tone={u.loginMethod === 'GOOGLE' ? 'primary' : 'neutral'}>
                {t(`enums.loginMethod.${u.loginMethod}`)}
              </Badge>
              {!u.isActive && <Badge tone="neutral">{t('users.inactive')}</Badge>}
              <div className="flex">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('common.edit')}
                  onClick={() => setDialog({ user: u })}
                >
                  <Pencil />
                </Button>
                <ConfirmationDialog
                  trigger={
                    <Button size="icon-sm" variant="ghost" aria-label={t('googleAccess.revoke')}>
                      <Trash2 />
                    </Button>
                  }
                  title={t('googleAccess.revoke')}
                  body={t('googleAccess.revokeBody')}
                  confirmLabel={t('googleAccess.revoke')}
                  isLoading={revoke.isPending}
                  onConfirm={() =>
                    revoke
                      .mutateAsync(u.id)
                      .then(() => notify.success(t('googleAccess.revoked')))
                      .catch((e: Error) => notify.error(t('common.error'), e.message))
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
      {dialog && <GoogleAccessDialog user={dialog.user} onClose={() => setDialog(null)} />}
    </Card>
  );
}
