import { useState } from 'react';
import type { AccessLevel, User, UserAccessRow } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useSetAccess, useUserAccess } from '@/features/admin/api';

type Kind = 'topics' | 'businesses';
type Choice = AccessLevel | 'NONE';

/** The creator keeps EDIT without a grant, so "no access" is not offered for their own items. */
const choicesFor = (row: UserAccessRow): Choice[] =>
  row.isCreator ? ['VIEW', 'EDIT'] : ['NONE', 'VIEW', 'EDIT'];

/**
 * Owner only: which topics and businesses one user can view or edit (docs/17).
 * Mounted only while open.
 */
export function AccessDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<Kind>('topics');
  const [q, setQ] = useState('');
  const { data, isLoading } = useUserAccess(user.id);
  const set = useSetAccess(user.id);

  const change = (row: UserAccessRow, choice: Choice) => {
    // EDIT on one's own item is the default, so it is stored as "no grant"
    const access = choice === 'NONE' || (row.isCreator && choice === 'EDIT') ? null : choice;
    set.mutate(
      { kind, id: row.id, data: { access } },
      {
        onSuccess: () => notify.success(t('users.accessSaved')),
        onError: (e: Error) => notify.error(t('common.error'), e.message),
      },
    );
  };

  const all = data?.[kind];
  const rows = all?.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t('users.accessTitle', { name: user.name })}
      description={t('users.accessHint')}
    >
      <div className="space-y-3">
        <Segmented<Kind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'topics', label: t('users.accessTopics') },
            { value: 'businesses', label: t('users.accessBusinesses') },
          ]}
        />
        {(all?.length ?? 0) > 6 && (
          <Input
            placeholder={t('common.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        {isLoading && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}
        {all?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('users.accessEmpty')}</p>
        )}
        {!!rows?.length && (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.isCreator && <Badge tone="primary">{t('users.creator')}</Badge>}
                    {row.status === 'ARCHIVED' && (
                      <Badge tone="neutral">{t('users.archived')}</Badge>
                    )}
                  </div>
                </div>
                <Segmented<Choice>
                  value={row.effective ?? 'NONE'}
                  onChange={(v) => change(row, v)}
                  options={choicesFor(row).map((c) => ({
                    value: c,
                    label: t(`users.access.${c}`),
                  }))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
