import { useState } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { formatNumber, formatPercent } from '@/utils/format';
import { useFeedbackSummary } from '../api/feedback';

const PERIODS = [30, 90, 365] as const;

/** Back-office view of 👍/👎 votes, counted by code per prompt version and model (docs/46). */
export function FeedbackSummaryCard() {
  const t = useT();
  const [days, setDays] = useState<number>(90);
  const { data, isLoading } = useFeedbackSummary(days);
  return (
    <Card className="mb-6">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MessageSquareWarning className="size-4" />
            {t('feedback.summary.title')}
          </span>
        }
        description={t('feedback.summary.subtitle')}
        descriptionAsTip
        actions={
          <Select
            aria-label={t('feedback.summary.title')}
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            options={PERIODS.map((d) => ({
              value: String(d),
              label: t('feedback.summary.lastDays', { n: formatNumber(d) }),
            }))}
          />
        }
      />
      <CardBody>
        {isLoading || !data ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : data.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('feedback.summary.none')}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <StatCard label={t('feedback.summary.total')} value={formatNumber(data.total)} />
              <StatCard
                label={t('feedback.summary.down')}
                value={formatNumber(data.down)}
                tone="warning"
              />
              <StatCard
                label={t('feedback.summary.downShare')}
                value={data.downShare === null ? '—' : formatPercent(data.downShare, 0)}
              />
            </div>
            {data.byPrompt.length > 0 && (
              <div className="overflow-x-auto">
                <h3 className="mb-2 text-sm font-semibold">{t('feedback.summary.byPrompt')}</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 text-start font-medium">
                        {t('feedback.summary.prompt')}
                      </th>
                      <th className="py-1 text-start font-medium">{t('feedback.summary.model')}</th>
                      <th className="py-1 text-end font-medium">{t('feedback.summary.up')}</th>
                      <th className="py-1 text-end font-medium">{t('feedback.summary.downCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPrompt.map((r) => (
                      <tr
                        key={`${r.promptKey}-${r.promptVersion}-${r.model}-${r.type}`}
                        className="border-t"
                      >
                        <td className="py-1.5" dir="ltr">
                          {r.promptKey ?? r.type ?? '—'}
                          {r.promptVersion !== null && ` v${r.promptVersion}`}
                        </td>
                        <td className="py-1.5" dir="ltr">
                          {r.model ?? '—'}
                        </td>
                        <td className="py-1.5 text-end">{formatNumber(r.up)}</td>
                        <td className="py-1.5 text-end">{formatNumber(r.down)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.byReason.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('feedback.summary.byReason')}</h3>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {data.byReason.map((r) => (
                    <li key={r.reason} className="rounded-md bg-muted px-2 py-1">
                      {t(`feedback.reasons.${r.reason}`)} · {formatNumber(r.count)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.recentNotes.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('feedback.summary.recentNotes')}</h3>
                <ul className="space-y-2 text-sm">
                  {data.recentNotes.map((n) => (
                    <li key={n.id} className="rounded-md border p-2" data-bidi="">
                      {n.reason && (
                        <span className="me-2 text-xs text-muted-foreground">
                          {t(`feedback.reasons.${n.reason}`)}
                        </span>
                      )}
                      {n.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
