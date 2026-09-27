import { useT } from '@/i18n';
import { formatNumber } from '@/utils/format';

/** How many of the business profile sections have content. */
export function CompletenessBar({ filled, total }: { filled: number; total: number }) {
  const t = useT();
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t('businesses.completeness', {
            filled: formatNumber(filled),
            total: formatNumber(total),
          })}
        </span>
        <span className="tabular-nums">{formatNumber(pct)}٪</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={pct === 100 ? 'h-full bg-success' : 'h-full bg-primary'}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
