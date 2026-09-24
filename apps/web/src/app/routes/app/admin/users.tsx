import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search, Pencil } from 'lucide-react';
import {
  CreateUserSchema,
  Role,
  UpdateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type User,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { notify } from '@/stores/notifications';
import { formatDate, formatRelative } from '@/utils/format';
import { useCreateUser, useUpdateUser, useUsers } from '@/features/admin/api';

function UserDrawer({
  user,
  open,
  onOpenChange,
}: {
  user: User | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateUser();
  const update = useUpdateUser();
  const isEdit = !!user;
  const form = useForm<CreateUserInput & UpdateUserInput>({
    resolver: zodResolver(isEdit ? UpdateUserSchema : CreateUserSchema) as never,
  });

  useEffect(() => {
    if (open) {
      form.reset(
        user
          ? { name: user.name, role: user.role, isActive: user.isActive, password: '' }
          : { name: '', email: '', password: '', role: 'EDITOR' },
      );
    }
  }, [open, user, form]);

  const onSubmit = form.handleSubmit((values) => {
    const done = {
      onSuccess: () => {
        notify.success(isEdit ? t('common.saved') : t('users.created'));
        onOpenChange(false);
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (user) {
      const { name, role, isActive, password } = values;
      update.mutate(
        { id: user.id, data: { name, role, isActive, ...(password ? { password } : {}) } },
        done,
      );
    } else {
      create.mutate(values as CreateUserInput, done);
    }
  });

  const errors = form.formState.errors;
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? t('common.edit') : t('users.new')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="user-form" isLoading={create.isPending || update.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-4">
        <Field label={t('users.name')} error={errors.name?.message}>
          {(id) => <Input id={id} {...form.register('name')} />}
        </Field>
        {!isEdit && (
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
        <Field
          label={isEdit ? t('users.resetPassword') : t('users.password')}
          error={errors.password?.message}
        >
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              type="password"
              autoComplete="new-password"
              {...form.register('password', { setValueAs: (v) => (isEdit && !v ? undefined : v) })}
            />
          )}
        </Field>
        {isEdit && (
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
  const [editing, setEditing] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
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
            <p className="font-medium">{u.name}</p>
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
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('common.edit')}
          onClick={() => {
            setEditing(u);
            setOpen(true);
          }}
        >
          <Pencil />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button
            icon={<Plus />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
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
      <UserDrawer user={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}
