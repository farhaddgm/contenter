import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { Notification } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { formatNumber } from '@/utils/format';
import { useMarkAllRead, useMarkRead, useNotificationList, useUnreadCount } from '../api/inbox';
import { NotificationItem } from './notification-item';

/** The bell in the top bar: unread count, the latest notifications, mark all as read. */
export function NotificationBell() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount();
  // the list is only fetched once the bell is opened
  const list = useNotificationList({ page: 1, pageSize: 8 }, { enabled: open });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const openOne = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={
            unread ? t('inbox.bellUnread', { count: formatNumber(unread) }) : t('inbox.title')
          }
          className="relative rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
              {unread > 99 ? '99+' : formatNumber(unread)}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">{t('inbox.title')}</h2>
            <Button
              size="sm"
              variant="ghost"
              icon={<CheckCheck />}
              disabled={unread === 0}
              isLoading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              {t('inbox.markAll')}
            </Button>
          </div>
          <div className="max-h-96 divide-y overflow-y-auto">
            {!list.data?.items.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('inbox.empty')}
              </p>
            ) : (
              list.data.items.map((n) => (
                <NotificationItem key={n.id} notification={n} onOpen={openOne} />
              ))
            )}
          </div>
          <Link
            to={paths.app.notifications.getHref()}
            onClick={() => setOpen(false)}
            className="block border-t px-4 py-2.5 text-center text-sm text-primary hover:bg-muted/60"
          >
            {t('inbox.viewAll')}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
