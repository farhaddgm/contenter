import { useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import {
  COVERAGE_PERIODS,
  COVERAGE_PERIOD_DAYS,
  DEFAULT_STALE_DAYS,
  MIN_LABELED_FOR_SHARE,
  type CoverageBy,
  type CoverageReport,
} from '@contenter/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import { useCoverage } from '../api/coverage';

/**
 * Which pillars approved or published content covered, by platform or by 30-day period
 * (docs/50-coverage-map.md). Counted by code; content without a pillar has its own row so the
 * numbers do not look more complete than they are.
 */
export function CoverageMap({ businessId }: { businessId: string }) {
  const t = useT();
  const [days, setDays] = useState<number>(90);
  const [by, setBy] = useState<CoverageBy>('platform');
  const { data, isLoading } = useCoverage(businessId, { days, by, staleDays: DEFAULT_STALE_DAYS });
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Grid3x3 className="size-4" />
            {t('coverage.title')}
          </span>
        }
        description={t('coverage.subtitle')}
        descriptionAsTip
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label={t('coverage.period')}
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              options={COVERAGE_PERIODS.map((d) => ({
                value: String(d),
                label: t('coverage.lastDays', { n: formatNumber(d) }),
              }))}
            />
            <Select
              aria-label={t('coverage.by')}
              value={by}
              onChange={(e) => setBy(e.target.value as CoverageBy)}
              options={[
                { value: 'platform', label: t('coverage.byPlatform') },
                { value: 'period', label: t('coverage.byPeriod') },
              ]}
            />
          </div>
        }
      />
      <CardBody>
        {isLoading || !data ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <Matrix data={data} />
        )}
      </CardBody>
    </Card>
  );
}

function Matrix({ data }: { data: CoverageReport }) {
  const t = useT();
  const pillarRows = data.rows.filter((r) => r.pillarId !== null);
  if (pillarRows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('coverage.noPillars')}</p>;
  }
  // a platform no content used is not worth a column
  const cols = data.columns
    .map((key, i) => ({ key, i }))
    .filter(({ i }) => data.by === 'period' || data.rows.some((r) => r.counts[i]! > 0));
  const label = (key: string) => {
    if (data.by === 'platform') return t(`enums.platform.${key as 'X'}`);
    const n = Number(key.slice(1));
    return t('coverage.periodRange', {
      from: formatNumber(n * COVERAGE_PERIOD_DAYS),
      to: formatNumber((n + 1) * COVERAGE_PERIOD_DAYS),
    });
  };
  return (
    <div className="space-y-3">
      {data.total === 0 && (
        <p className="text-sm text-muted-foreground">{t('coverage.noContent')}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-start font-medium">{t('coverage.pillar')}</th>
              {cols.map((c) => (
                <th key={c.key} className="px-2 py-1 text-center font-medium">
                  {label(c.key)}
                </th>
              ))}
              <th className="px-2 py-1 text-center font-medium">{t('coverage.total')}</th>
              <th className="px-2 py-1 text-center font-medium">{t('coverage.share')}</th>
              <th className="py-1 text-end font-medium">{t('coverage.last')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr
                key={r.pillarId ?? 'none'}
                className={cn('border-t', r.pillarId === null && 'text-muted-foreground')}
              >
                <td className="py-1.5" dir="auto">
                  {r.name ?? t('coverage.unlabeled')}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-center tabular-nums">
                    {r.counts[c.i] ? formatNumber(r.counts[c.i]!) : '·'}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center font-medium tabular-nums">
                  {formatNumber(r.total)}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums">
                  {r.pillarId === null ? (
                    '—'
                  ) : r.share === null ? (
                    r.targetShare === null ? (
                      '—'
                    ) : (
                      t('coverage.targetOnly', { target: formatNumber(r.targetShare) })
                    )
                  ) : (
                    <span
                      className={cn(r.gap !== null && r.gap >= 10 && 'font-medium text-warning')}
                    >
                      {t('coverage.shareOf', { share: formatNumber(r.share) })}
                      {r.targetShare !== null && (
                        <span className="ms-1 text-xs text-muted-foreground">
                          {t('coverage.ofTarget', { target: formatNumber(r.targetShare) })}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    'py-1.5 text-end text-xs',
                    r.stale ? 'font-medium text-warning' : 'text-muted-foreground',
                  )}
                >
                  {r.pillarId === null
                    ? '—'
                    : r.daysSince === null
                      ? t('coverage.never')
                      : t('coverage.daysAgo', { n: formatNumber(r.daysSince) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {data.enoughLabeled
          ? t('coverage.note', {
              labeled: formatNumber(data.labeled),
              total: formatNumber(data.total),
            })
          : t('coverage.fewLabeled', { min: formatNumber(MIN_LABELED_FOR_SHARE) })}
      </p>
    </div>
  );
}
