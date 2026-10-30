import { Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { track } from '@/lib/tracker';
import { cn } from '@/utils/cn';
import { useSmartSummary } from '../api';
import { useSmart } from '../store';

/** Header button that opens the Smart panel (admins only), with the open-error count. */
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
      onClick={() => {
        track('smart.toggle', { target: 'open' });
        setEnabled(true);
        setMinimized(false);
      }}
      className={cn(
        'relative inline-flex h-10 items-center gap-2 rounded-full border bg-card px-3 text-sm font-semibold transition-colors hover:border-ring/60',
        enabled ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Sparkles className={cn('size-4', enabled && 'fill-primary/20')} />
      <span className="hidden sm:inline">{t('smart.name')}</span>
      {open > 0 && (
        <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {open > 99 ? '99+' : open}
        </span>
      )}
    </button>
  );
}
