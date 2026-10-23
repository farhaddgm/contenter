import { BarChart3 } from 'lucide-react';
import {
  SHARE_METRICS,
  type CompareMetric,
  type CompareReport,
  type CompareState,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { formatNumber } from '@/utils/format';
import { useCompetitorCompare } from '../api/competitors';

/** "3.2", or "30%" for a share; "—" when there is no number. */
export function metricText(metric: CompareMetric, value: number | null): string {
  if (value === null) return '—';
  return SHARE_METRICS.includes(metric)
    ? `${formatNumber(Math.round(value * 100))}%`
    : metric === 'engagementRatePct'
      ? `${formatNumber(value, 2)}%`
      : formatNumber(value, 1);
}

function StateNote({ state }: { state: CompareState }) {
  const t = useT();
  if (state === 'OK') return null;
  return (
    <Badge tone={state === 'NONE' ? 'neutral' : 'warning'} className="ms-1">
      {t(`businesses.competitors.compare.state.${state}`)}
    </Badge>
  );
}

/**
 * The business's Instagram numbers next to its competitors' (docs/70 phase 2). Counted by code
 * from the Instagram sources; it says nothing about the audience and shows no number from fewer
 * than 6 analyzed posts.
 */
export function CompetitorCompareCard({ businessId, hasCompetitors }: { businessId: string; hasCompetitors: boolean }) {
  const t = useT();
  const { data, isLoading } = useCompetitorCompare(businessId, hasCompetitors);
  if (!hasCompetitors) return null;
  const withData = data?.competitors.some((c) => c.state === 'OK') ?? false;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BarChart3 className="size-4" />
            {t('businesses.competitors.compare.title')}
          </span>
        }
        description={t('businesses.competitors.compare.hint')}
        descriptionAsTip
      />
      <CardBody className="space-y-4">
        {isLoading || !data ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : !withData ? (
          <p className="text-sm text-muted-foreground">{t('businesses.competitors.compare.noData')}</p>
        ) : (
          <CompareTable report={data} />
        )}
      </CardBody>
    </Card>
  );
}

function CompareTable({ report }: { report: CompareReport }) {
  const t = useT();
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pe-3 text-start font-medium" />
              <th className="px-3 py-2 text-start font-medium">
                {t('businesses.competitors.compare.us')}
                <StateNote state={report.brand.state} />
              </th>
              {report.competitors.map((c) => (
                <th key={c.id} className="px-3 py-2 text-start font-medium" data-bidi="">
                  {c.name}
                  <StateNote state={c.state} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.metric} className="border-b last:border-0">
                <th className="py-2 pe-3 text-start font-normal">
                  {t(`businesses.competitors.compare.metrics.${r.metric}`)}
                  {r.followerDependent && (
                    <span className="block text-xs text-muted-foreground">
                      {t('businesses.competitors.compare.followerDependent')}
                    </span>
                  )}
                </th>
                <td className="px-3 py-2 tabular-nums font-semibold">{metricText(r.metric, r.brand)}</td>
                {r.values.map((v) => (
                  <td key={v.id} className="px-3 py-2 tabular-nums">
                    {metricText(r.metric, v.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.hashtags.overlap !== null && (
        <div className="space-y-1 text-sm">
          <p>
            {t('businesses.competitors.compare.overlap', {
              pct: formatNumber(Math.round(report.hashtags.overlap * 100)),
            })}
          </p>
          {report.hashtags.shared.length > 0 && (
            <p className="text-xs text-muted-foreground" data-bidi="">
              {t('businesses.competitors.compare.shared')}: {report.hashtags.shared.map((h) => `#${h}`).join('، ')}
            </p>
          )}
          {report.hashtags.onlyTheirs.length > 0 && (
            <p className="text-xs text-muted-foreground" data-bidi="">
              {t('businesses.competitors.compare.onlyTheirs')}:{' '}
              {report.hashtags.onlyTheirs
                .slice(0, 8)
                .map((h) => `${h.tag} (${h.from.join('، ')})`)
                .join('، ')}
            </p>
          )}
        </div>
      )}
    </>
  );
}
