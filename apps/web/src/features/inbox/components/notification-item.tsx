import {
  AtSign,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  CornerDownLeft,
  MessageSquare,
  MessageSquareWarning,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { notificationMessage, type Notification, type NotificationEvent } from '@contenter/shared';
import { useUi } from '@/stores/ui';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/format';

const ICON: Record<NotificationEvent, { icon: LucideIcon; tone: string }> = {
  REVIEW_SUBMITTED: { icon: Send, tone: 'text-primary' },
  REVIEW_FINAL_NEEDED: { icon: ClipboardCheck, tone: 'text-warning' },
  REVIEW_APPROVED: { icon: CheckCircle2, tone: 'text-success' },
  REVIEW_CHANGES_REQUESTED: { icon: MessageSquareWarning, tone: 'text-warning' },
  REVIEW_REJECTED: { icon: XCircle, tone: 'text-destructive' },
  COMMENT_ADDED: { icon: MessageSquare, tone: 'text-primary' },
  COMMENT_REPLIED: { icon: CornerDownLeft, tone: 'text-primary' },
  CONTENT_DUE: { icon: BellRing, tone: 'text-destructive' },
};

/** The text of a notification in the reader's language. */
export function useNotificationText(n: Notification) {
  const lang = useUi((s) => s.lang);
  return notificationMessage(
    n.event,
    n.params,
    lang,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

/** One notification row: icon, message, reason and time; unread ones are marked. */
export function NotificationItem({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: (n: Notification) => void;
}) {
  const { title, body } = useNotificationText(notification);
  const { icon: Icon, tone } = ICON[notification.event] ?? { icon: AtSign, tone: '' };
  const unread = !notification.readAt;
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-start transition hover:bg-muted/60',
        unread && 'bg-primary/5',
      )}
    >
      <Icon className={cn('mt-1 size-4 shrink-0', tone)} />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className={cn('block text-sm leading-6', unread && 'font-semibold')} dir="auto">
          {title}
        </span>
        {body && (
          <span className="line-clamp-2 block text-xs leading-5 text-muted-foreground" dir="auto">
            {body}
          </span>
        )}
        <span className="block text-[11px] text-muted-foreground">
          {formatRelative(notification.createdAt)}
        </span>
      </span>
      {unread && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="unread" />
      )}
    </button>
  );
}
