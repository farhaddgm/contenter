import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Circle } from 'lucide-react';
import type { BusinessHealth, HealthCheck } from '@contenter/shared';
import { Card, CardBody } from '@/components/ui/card';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';

const LEVEL_ICON = {
  todo: <Circle className="size-4 shrink-0 text-muted-foreground" />,
  warn: <AlertCircle className="size-4 shrink-0 text-warning" />,
  ok: <CheckCircle2 className="size-4 shrink-0 text-success" />,
} as const;

/**
 * Profile health (deterministic, `businessHealth` in shared): a score, the sections filled, and
 * the next steps — each one a shortcut to where it is fixed.
 */
export function HealthCard({
  health,
  onAction,
}: {
  health: BusinessHealth;
  /** Clicking a check: jump to its section / tab. */
  onAction: (check: HealthCheck) => void;
}) {
  const t = useT();
  const [showDone, setShowDone] = useState(false);
  const pending = health.checks.filter((c) => c.level !== 'ok');
  const done = health.checks.filter((c) => c.level === 'ok');
  const tone =
    health.score >= 80
      ? 'var(--success)'
      : health.score >= 50
        ? 'var(--warning)'
        : 'var(--primary)';

  const row = (c: HealthCheck) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => onAction(c)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start text-xs leading-5 hover:bg-muted"
      >
        {LEVEL_ICON[c.level]}
        <span>
          {t(`businesses.health.checks.${c.id}.${c.level}`, { count: formatNumber(c.count) })}
        </span>
      </button>
    </li>
  );

  return (
    <Card>
      <CardBody className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <div
            className="relative flex size-14 shrink-0 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(${tone} ${health.score}%, var(--muted) 0)` }}
            aria-hidden
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-card text-base font-bold tabular-nums">
              {formatNumber(health.score)}
            </div>
          </div>
          <div className="min-w-0">
            <p className="font-semibold">{t('businesses.health.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('businesses.completeness', {
                filled: formatNumber(health.filled),
                total: formatNumber(health.total),
              })}
            </p>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t('businesses.health.hint')}</p>

        {pending.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              {t('businesses.health.next')}
            </p>
            <ul className="-mx-2">{pending.map(row)}</ul>
          </div>
        )}
        {done.length > 0 && (
          <div>
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn('size-3.5 transition', showDone && 'rotate-180')} />
              {t('businesses.health.done')} ({formatNumber(done.length)})
            </button>
            {showDone && <ul className="-mx-2 mt-1">{done.map(row)}</ul>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
