import { useState } from 'react';
import type { TopicAccess, User, UserTopicAccess } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useSetTopicAccess, useUserTopicAccess } from '@/features/admin/api';

type Choice = TopicAccess | 'NONE';

/** The creator keeps EDIT without a grant, so "no access" is not offered for their own topics. */
const choicesFor = (row: UserTopicAccess): Choice[] =>
  row.isCreator ? ['VIEW', 'EDIT'] : ['NONE', 'VIEW', 'EDIT'];

/** Admin: which topics (projects) one user can view or edit (docs/17). Mounted only while open. */
export function TopicAccessDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const { data, isLoading } = useUserTopicAccess(user.id);
  const set = useSetTopicAccess(user.id);

  const change = (row: UserTopicAccess, choice: Choice) => {
    // EDIT on one's own topic is the default, so it is stored as "no grant"
    const access = choice === 'NONE' || (row.isCreator && choice === 'EDIT') ? null : choice;
    set.mutate(
      { topicId: row.topicId, data: { access } },
      {
        onSuccess: () => notify.success(t('users.accessSaved')),
        onError: (e: Error) => notify.error(t('common.error'), e.message),
      },
    );
  };

  const rows = data?.filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t('users.projectsTitle', { name: user.name })}
      description={t('users.projectsHint')}
    >
      <div className="space-y-3">
        {(data?.length ?? 0) > 6 && (
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
        {data?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('users.projectsEmpty')}
          </p>
        )}
        <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border">
          {rows?.map((row) => (
            <li key={row.topicId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.title}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.isCreator && <Badge tone="primary">{t('users.creator')}</Badge>}
                  {row.status === 'ARCHIVED' && <Badge tone="neutral">{t('users.archived')}</Badge>}
                </div>
              </div>
              <Segmented<Choice>
                value={row.effective ?? 'NONE'}
                onChange={(v) => change(row, v)}
                options={choicesFor(row).map((c) => ({ value: c, label: t(`users.access.${c}`) }))}
              />
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
