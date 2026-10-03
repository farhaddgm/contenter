import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import {
  CreateUserSchema,
  LoginMethod,
  Role,
  UpdateUserSchema,
  isGmail,
  type CreateUserInput,
  type UpdateUserInput,
  type User,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form-controls';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { useDebounce } from '@/hooks/use-debounce';
import { notify } from '@/stores/notifications';
import { formatDate, formatRelative } from '@/utils/format';
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from '@/features/admin/api';

type FormValues = CreateUserInput & UpdateUserInput;

/** Create / edit a user. Mounted only while open, so defaults need no reset. */
function UserDrawer({ user, onClose }: { user: User | null; onClose: () => void }) {
  const t = useT();
  const me = useUser();
  const create = useCreateUser();
  const update = useUpdateUser();
  const form = useForm<FormValues>({
    resolver: zodResolver(user ? UpdateUserSchema : CreateUserSchema) as never,
    defaultValues: user
      ? { name: user.name, role: user.role, isActive: user.isActive, loginMethod: user.loginMethod }
      : { name: '', email: '', role: 'EDITOR', loginMethod: 'PASSWORD' },
  });
  const [method, isActive, email] = useWatch({
    control: form.control,
    name: ['loginMethod', 'isActive', 'email'],
  });
  const current = method ?? 'PASSWORD';
  // Gmail sign-in is the owner's call (docs/11) and only works for @gmail.com addresses.
  const canChooseMethod = !!me?.isOwner && isGmail(user?.email ?? email ?? '');
  const needsPassword =
    current !== 'GOOGLE' && (!user || !user.hasPassword || user.loginMethod === 'GOOGLE');
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    if (needsPassword && !values.password) {
      form.setError('password', { message: t('googleAccess.passwordRequired') });
      return;
    }
    const password = current !== 'GOOGLE' && values.password ? values.password : undefined;
    const done = {
      onSuccess: () => {
        notify.success(user ? t('common.saved') : t('users.created'));
        onClose();
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (user) {
      const { name, role, isActive: active } = values;
      update.mutate(
        {
          id: user.id,
          data: {
            name,
            role,
            isActive: active,
            ...(current !== user.loginMethod ? { loginMethod: current } : {}),
            ...(password ? { password } : {}),
          },
        },
        done,
      );
    } else {
      const { email: address, name, role } = values;
      create.mutate({ email: address, name, role, loginMethod: current, password }, done);
    }
  });

  const methodHint = canChooseMethod
    ? t(`users.methodHint.${current}`)
    : me?.isOwner
      ? t('users.methodGmailOnly')
      : t('users.methodOwnerOnly');

  return (
    <Drawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={user ? t('common.edit') : t('users.new')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="user-form" isLoading={create.isPending || update.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-4">
        {user && (
          <p className="text-sm text-muted-foreground" dir="ltr">
            {user.email}
          </p>
        )}
        <Field label={t('users.name')} error={errors.name?.message}>
          {(id) => <Input id={id} {...form.register('name')} />}
        </Field>
        {!user && (
          <Field label={t('users.email')} error={errors.email?.message}>
            {(id) => <Input id={id} dir="ltr" type="email" {...form.register('email')} />}
          </Field>
        )}
        <Field label={t('users.role')}>
          {(id) => (
            <Select
              id={id}
              options={Role.map((r) => ({ value: r, label: t(`enums.role.${r}`) }))}
              {...form.register('role')}
            />
          )}
        </Field>
        <Field label={t('users.loginMethod')} hint={methodHint}>
          {() => (
            <div>
              {canChooseMethod ? (
                <Segmented
                  value={current}
                  onChange={(v) => {
                    form.setValue('loginMethod', v);
                    form.clearErrors('password');
                  }}
                  options={LoginMethod.map((m) => ({
                    value: m,
                    label: t(`enums.loginMethod.${m}`),
                  }))}
                />
              ) : (
                <Badge tone={current === 'PASSWORD' ? 'outline' : 'neutral'}>
                  {t(`enums.loginMethod.${current}`)}
                </Badge>
              )}
            </div>
          )}
        </Field>
        {current !== 'GOOGLE' && (
          <Field
            label={needsPassword ? t('users.password') : t('users.resetPassword')}
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
    </Drawer>
  );
}

export default function UsersRoute() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const me = useUser();
  const [drawer, setDrawer] = useState<{ user: User | null } | null>(null);
  const remove = useDeleteUser();
  const { data, isLoading } = useUsers({ page, q: debouncedQ });

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: t('users.name'),
      cell: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {u.name.slice(0, 1)}
          </span>
          <div>
            <p className="flex items-center gap-2 font-medium">
              {u.name}
              {u.isOwner && <Badge tone="primary">{t('users.owner')}</Badge>}
            </p>
            <p className="text-xs text-muted-foreground" dir="ltr">
              {u.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('users.role'),
      cell: (u) => (
        <Badge tone={u.role === 'ADMIN' ? 'primary' : 'outline'}>{t(`enums.role.${u.role}`)}</Badge>
      ),
    },
    {
      key: 'loginMethod',
      header: t('users.loginMethod'),
      cell: (u) => (
        <Badge tone={u.loginMethod === 'PASSWORD' ? 'outline' : 'neutral'}>
          {t(`enums.loginMethod.${u.loginMethod}`)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (u) => (
        <Badge tone={u.isActive ? 'success' : 'neutral'}>
          {u.isActive ? t('users.active') : t('users.inactive')}
        </Badge>
      ),
    },
    {
      key: 'last',
      header: t('users.lastLogin'),
      cell: (u) => (
        <span className="text-xs text-muted-foreground">{formatRelative(u.lastLoginAt)}</span>
      ),
    },
    {
      key: 'created',
      header: t('common.createdAt'),
      cell: (u) => (
        <span className="text-xs text-muted-foreground">{formatDate(u.createdAt, false)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-end',
      cell: (u) => (
        <div className="flex justify-end">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={u.isOwner && !me?.isOwner}
            aria-label={t('common.edit')}
            onClick={() => setDrawer({ user: u })}
          >
            <Pencil />
          </Button>
          <ConfirmationDialog
            trigger={
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={u.isOwner || u.id === me?.id}
                aria-label={t('users.delete')}
              >
                <Trash2 />
              </Button>
            }
            title={t('users.delete')}
            body={t('users.deleteBody', { name: u.name })}
            confirmLabel={t('users.delete')}
            isLoading={remove.isPending}
            onConfirm={() =>
              remove
                .mutateAsync(u.id)
                .then(() => notify.success(t('users.deleted')))
                .catch((e: Error) => notify.error(t('common.error'), e.message))
            }
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button icon={<Plus />} onClick={() => setDrawer({ user: null })}>
            {t('users.new')}
          </Button>
        }
      />
      <Card>
        <div className="border-b p-4">
          <div className="relative max-w-xs">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t('common.search')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <Table data={data?.items} columns={columns} isLoading={isLoading} />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
      {drawer && <UserDrawer user={drawer.user} onClose={() => setDrawer(null)} />}
    </>
  );
}
