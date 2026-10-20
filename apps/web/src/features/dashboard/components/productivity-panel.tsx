import { useState } from 'react';
import { CheckCircle2, CircleDollarSign, Clock, PenLine } from 'lucide-react';
import {
  MIN_PRODUCTIVITY_SAMPLES,
  PRODUCTIVITY_PERIODS,
  type DurationStats,
  type ProductivityStats,
} from '@contenter/shared';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useTopics } from '@/features/topics/api/topics';
import { formatNumber, formatPercent, formatUsd } from '@/utils/format';
import { useProductivity } from '../api/productivity';

/** Hours as "۱٫۵ ساعت" below two days, otherwise as days. */
function useDuration() {
  const t = useT();
  return (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 48) return t('productivity.hours', { n: formatNumber(hours, 1) });
    return t('productivity.days', { n: formatNumber(hours / 24, 1) });
  };
}

/**
 * Productivity of the team and the AI (docs/44-productivity-dashboard.md). The server counts
 * everything; numbers that would be noise with few contents are shown as "—".
 */
export function ProductivityPanel() {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const [topicId, setTopicId] = useState('');
  const topics = useTopics({ page: 1, pageSize: 100 });
  const { data, isLoading } = useProductivity({ days, topicId: topicId || undefined });

  return (
    <Card className="mt-6">
      <CardHeader
        title={t('productivity.title')}
        description={t('productivity.subtitle')}
        descriptionAsTip
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label={t('productivity.period')}
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              options={PRODUCTIVITY_PERIODS.map((d) => ({
                value: String(d),
                label: t('productivity.lastDays', { n: formatNumber(d) }),
              }))}
            />
            <Select
              aria-label={t('productivity.topic')}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              options={[
                { value: '', label: t('productivity.allTopics') },
                ...(topics.data?.items ?? []).map((tp) => ({ value: tp.id, label: tp.title })),
              ]}
            />
          </div>
        }
      />
      <CardBody>
        {isLoading || !data ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <Numbers data={data} />
        )}
      </CardBody>
    </Card>
  );
}

function Numbers({ data }: { data: ProductivityStats }) {
  const t = useT();
  const duration = useDuration();
  const few = data.approved < MIN_PRODUCTIVITY_SAMPLES;
  const slow = (d: DurationStats) =>
    d.p90Hours === null ? undefined : t('productivity.slowEnd', { value: duration(d.p90Hours) });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label={t('productivity.approved')}
          value={formatNumber(data.approved)}
          icon={<CheckCircle2 />}
          tone="success"
        />
        <StatCard
          label={t('productivity.unedited')}
          value={data.uneditedShare === null ? '—' : formatPercent(data.uneditedShare, 0)}
          hint={t('productivity.uneditedHint', {
            unedited: formatNumber(data.unedited),
            edited: formatNumber(data.edited),
          })}
          icon={<PenLine />}
        />
        <StatCard
          label={t('productivity.cycle')}
          value={duration(data.cycle.medianHours)}
          hint={slow(data.cycle)}
          icon={<Clock />}
          tone="warning"
        />
        <StatCard
          label={t('productivity.perApproved')}
          value={data.cost.perApprovedUsd === null ? '—' : formatUsd(data.cost.perApprovedUsd)}
          hint={t('productivity.totalCost', { value: formatUsd(data.cost.totalUsd) })}
          icon={<CircleDollarSign />}
        />
      </div>
      {few && (
        <p className="text-sm text-muted-foreground">
          {t('productivity.fewSamples', { min: formatNumber(MIN_PRODUCTIVITY_SAMPLES) })}
        </p>
      )}
      {data.review.medianHours !== null && (
        <p className="text-sm text-muted-foreground">
          {t('productivity.reviewLine', { value: duration(data.review.medianHours) })}
        </p>
      )}
      {data.byJobType.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-start font-medium">{t('productivity.jobType')}</th>
                <th className="py-2 text-end font-medium">{t('productivity.jobs')}</th>
                <th className="py-2 text-end font-medium">{t('productivity.failed')}</th>
                <th className="py-2 text-end font-medium">{t('productivity.retried')}</th>
                <th className="py-2 text-end font-medium">{t('productivity.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {data.byJobType.map((j) => (
                <tr key={j.type} className="border-b last:border-0">
                  <td className="py-2">{t(`enums.jobType.${j.type}`)}</td>
                  <td className="py-2 text-end">{formatNumber(j.total)}</td>
                  <td className="py-2 text-end">
                    {j.failed ? (
                      <span className="text-destructive">
                        {formatNumber(j.failed)} ({formatPercent(j.failed / j.total, 0)})
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 text-end">{j.retried ? formatNumber(j.retried) : '—'}</td>
                  <td className="py-2 text-end">{formatUsd(j.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
