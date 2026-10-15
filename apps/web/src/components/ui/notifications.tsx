import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useT } from '@/i18n';
import { useNotifications, type NotificationType } from '@/stores/notifications';
import { cn } from '@/utils/cn';

const icons: Record<NotificationType, React.ReactNode> = {
  info: <Info className="text-primary" />,
  success: <CheckCircle2 className="text-success" />,
  warning: <AlertTriangle className="text-warning" />,
  error: <XCircle className="text-destructive" />,
};

export function Notifications() {
  const t = useT();
  const { notifications, dismiss } = useNotifications();
  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:bottom-auto sm:top-0"
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          role={n.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-3 rounded-xl border bg-card p-3.5 shadow-pop',
            '[&_svg]:size-5 [&_svg]:shrink-0',
          )}
        >
          {icons[n.type]}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{n.title}</p>
            {n.message && (
              <p className="mt-0.5 break-words text-xs text-muted-foreground">{n.message}</p>
            )}
          </div>
          <button
            onClick={() => dismiss(n.id)}
            aria-label={t('common.close')}
            className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="!size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
