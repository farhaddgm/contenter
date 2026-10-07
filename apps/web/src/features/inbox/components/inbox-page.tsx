import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import type { Notification } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState, Pagination } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useMarkAllRead, useMarkRead, useNotificationList, useUnreadCount } from '../api/inbox';
import { NotificationItem } from './notification-item';

/** All notifications of the signed-in user, with a switch to show only the unread ones. */
export function InboxPage() {
  const t = useT();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const { data, isLoading } = useNotificationList({ page, unread: filter === 'unread' });
  const { data: unread = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <PageHeader
        title={t('inbox.title')}
        description={t('inbox.subtitle')}
        actions={
          <>
            <Segmented
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              options={[
                { value: 'all', label: t('common.all') },
                { value: 'unread', label: t('inbox.unread') },
              ]}
            />
            <Button
              variant="outline"
              icon={<CheckCheck />}
              disabled={unread === 0}
              isLoading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              {t('inbox.markAll')}
            </Button>
          </>
        }
      />
      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Bell />}
            title={filter === 'unread' ? t('inbox.noneUnread') : t('inbox.empty')}
          />
        ) : (
          <div className="divide-y">
            {data.items.map((n) => (
              <NotificationItem key={n.id} notification={n} onOpen={open} />
            ))}
          </div>
        )}
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
    </>
  );
}
