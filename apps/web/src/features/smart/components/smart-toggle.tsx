import { Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { track } from '@/lib/tracker';
import { cn } from '@/utils/cn';
import { useSmartSummary } from '../api';
import { useSmart } from '../store';

/** Header on/off switch for Smart (admins only), with the open-error count. */
export function SmartToggle() {
  const t = useT();
  const { can } = useAuthorization();
  const isAdmin = can('backoffice:access');
  const { enabled, setEnabled, setMinimized } = useSmart();
  const summary = useSmartSummary(isAdmin);
  if (!isAdmin) return null;
  const open = summary.data?.openErrors ?? 0;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      title={enabled ? t('smart.toggleOff') : t('smart.toggleOn')}
      onClick={() => {
        track('smart.toggle', { target: enabled ? 'off' : 'on' });
        setEnabled(!enabled);
        if (!enabled) setMinimized(false);
      }}
      className={cn(
        'relative inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        enabled
          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
          : 'border-input text-muted-foreground hover:bg-muted',
      )}
    >
      <Sparkles className={cn('size-4', enabled && 'fill-primary/20')} />
      <span className="hidden sm:inline">{t('smart.name')}</span>
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          enabled ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-full bg-white shadow transition-all',
            enabled ? 'start-3.5' : 'start-0.5',
          )}
        />
      </span>
      {open > 0 && (
        <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {open > 99 ? '99+' : open}
        </span>
      )}
    </button>
  );
}
