import { AlertOctagon, X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { useSmart } from '../store';

/** Error toasts raised by the Smart error tracker; shown on the side opposite the panel. */
export function SmartToasts() {
  const t = useT();
  const { toasts, dismissToast, openError, side } = useSmart();
  if (!toasts.length) return null;
  return (
    <div
      aria-live="assertive"
      className={cn(
        'pointer-events-none fixed bottom-4 z-[65] flex w-full max-w-sm flex-col gap-2 px-4',
        side === 'left' ? 'right-0' : 'left-0',
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="pointer-events-auto flex items-start gap-3 rounded-lg border border-destructive/40 bg-card p-3.5 shadow-xl"
        >
          <AlertOctagon className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {t('smart.errors.toastTitle')}
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                {t(`smart.errors.sourceLabels.${toast.source}`)}
              </span>
            </p>
            <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground" dir="auto">
              {toast.message}
            </p>
            <button
              className="mt-1.5 text-xs font-medium text-primary hover:underline"
              onClick={() => {
                openError(toast.errorId);
                dismissToast(toast.id);
              }}
            >
              {t('smart.errors.details')}
            </button>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="close"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
