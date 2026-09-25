import {
  AlertOctagon,
  ArrowLeftRight,
  Footprints,
  MessageSquareText,
  Minus,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { useSmartSummary } from '../api';
import { useSmart, type SmartTab } from '../store';
import { ErrorsTab } from './errors-tab';
import { WalkerChat } from './walker-chat';
import { WalkerTab } from './walker-tab';

/** Medium-size floating window docked to the left or right edge of the browser. */
export function SmartPanel() {
  const t = useT();
  const { side, toggleSide, minimized, setMinimized, tab, setTab } = useSmart();
  const summary = useSmartSummary(true);
  const openErrors = summary.data?.openErrors ?? 0;
  const edge = side === 'left' ? 'left-4' : 'right-4';

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className={cn(
          'fixed bottom-4 z-[60] flex items-center gap-2 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-2xl transition hover:scale-105',
          edge,
        )}
        aria-label={t('smart.expand')}
      >
        <Sparkles className="size-4" />
        {t('smart.name')}
        {openErrors > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{openErrors}</span>
        )}
      </button>
    );
  }

  const tabs: { key: SmartTab; label: string; icon: ReactNode; badge?: number }[] = [
    { key: 'walker', label: t('smart.tabs.walker'), icon: <Footprints /> },
    { key: 'chat', label: t('smart.tabs.chat'), icon: <MessageSquareText /> },
    { key: 'errors', label: t('smart.tabs.errors'), icon: <AlertOctagon />, badge: openErrors },
  ];

  return (
    <section
      aria-label={t('smart.name')}
      className={cn(
        'fixed bottom-4 z-[60] flex h-[min(620px,calc(100vh-6rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl',
        edge,
      )}
    >
      <header className="flex items-center justify-between gap-2 bg-gradient-to-br from-indigo-500 to-purple-600 px-4 py-2.5 text-white">
        <span className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4" /> {t('smart.name')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleSide}
            className="rounded-md p-1.5 hover:bg-white/15"
            title={t('smart.switchSide')}
            aria-label={t('smart.switchSide')}
          >
            <ArrowLeftRight className="size-4" />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="rounded-md p-1.5 hover:bg-white/15"
            title={t('smart.minimize')}
            aria-label={t('smart.minimize')}
          >
            <Minus className="size-4" />
          </button>
        </div>
      </header>
      <nav className="flex border-b" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              '-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-medium transition-colors [&_svg]:size-4',
              tab === tb.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tb.icon}
            {tb.label}
            {!!tb.badge && (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                {tb.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {tab === 'walker' && <WalkerTab />}
        {tab === 'chat' && <WalkerChat />}
        {tab === 'errors' && <ErrorsTab />}
      </div>
    </section>
  );
}
