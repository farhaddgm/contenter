import { CheckCheck, EyeOff, MessageSquareText, RotateCcw, Eye } from 'lucide-react';
import type { AppError, ErrorStatus } from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JsonView } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { formatDate, formatNumber } from '@/utils/format';
import { useUpdateErrorStatus } from '../api';

export const errorStatusTone: Record<ErrorStatus, BadgeTone> = {
  NEW: 'danger',
  SEEN: 'warning',
  RESOLVED: 'success',
  IGNORED: 'neutral',
};

/** Full description of one AppError with status actions. */
export function ErrorDetail({
  error,
  onTalk,
  compact,
}: {
  error: AppError;
  onTalk?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const update = useUpdateErrorStatus();
  const setStatus = (status: ErrorStatus) => update.mutate({ id: error.id, status });
  const rows: [string, React.ReactNode][] = [
    [t('smart.errors.source'), t(`smart.errors.sourceLabels.${error.source}`)],
    [t('smart.errors.category'), t(`smart.errors.categoryLabels.${error.category}`)],
    [t('smart.errors.occurrences'), `×${formatNumber(error.count)}`],
    [t('smart.errors.firstSeen'), formatDate(error.firstSeenAt)],
    [t('smart.errors.lastSeen'), formatDate(error.lastSeenAt)],
  ];
  if (error.method || error.path)
    rows.push([
      t('smart.errors.request'),
      <code
        key="r"
        dir="ltr"
        className="text-[11px]"
      >{`${error.method ?? ''} ${error.path ?? ''} ${error.statusCode ? `→ ${error.statusCode}` : ''}`}</code>,
    ]);
  if (error.route)
    rows.push([
      t('smart.errors.page'),
      <code key="p" dir="ltr" className="text-[11px]">
        {error.route}
      </code>,
    ]);
  if (error.jobId)
    rows.push([
      t('smart.errors.job'),
      <code key="j" dir="ltr" className="text-[11px]">
        {error.jobId}
      </code>,
    ]);
  if (error.user) rows.push([t('audit.user'), error.user.name]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={errorStatusTone[error.status]}>
            {t(`smart.errors.statusLabels.${error.status}`)}
          </Badge>
          <Badge tone="outline">{t(`smart.errors.categoryLabels.${error.category}`)}</Badge>
        </div>
        <p
          className={compact ? 'text-sm font-medium leading-6' : 'font-semibold leading-7'}
          dir="auto"
        >
          {error.message}
        </p>
        {error.hint && (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-xs leading-6">
            <span className="font-semibold">{t('smart.errors.hint')}: </span>
            {error.hint}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {onTalk && (
          <Button size="sm" icon={<MessageSquareText />} onClick={onTalk}>
            {t('smart.errors.talkToAi')}
          </Button>
        )}
        {error.status === 'NEW' && (
          <Button size="sm" variant="outline" icon={<Eye />} onClick={() => setStatus('SEEN')}>
            {t('smart.errors.markSeen')}
          </Button>
        )}
        {(error.status === 'NEW' || error.status === 'SEEN') && (
          <>
            <Button
              size="sm"
              variant="outline"
              icon={<CheckCheck />}
              onClick={() => setStatus('RESOLVED')}
            >
              {t('smart.errors.resolve')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<EyeOff />}
              onClick={() => setStatus('IGNORED')}
            >
              {t('smart.errors.ignore')}
            </Button>
          </>
        )}
        {(error.status === 'RESOLVED' || error.status === 'IGNORED') && (
          <Button size="sm" variant="outline" icon={<RotateCcw />} onClick={() => setStatus('NEW')}>
            {t('smart.errors.reopen')}
          </Button>
        )}
      </div>

      <dl className="divide-y rounded-lg border text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate text-end">{v}</dd>
          </div>
        ))}
      </dl>

      {error.detail && (
        <details className="rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">{t('smart.errors.stack')}</summary>
          <pre
            dir="ltr"
            className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-start text-[11px] leading-5"
          >
            {error.detail}
          </pre>
        </details>
      )}
      {!!error.context && (
        <details className="rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">{t('smart.errors.context')}</summary>
          <div className="mt-2">
            <JsonView value={error.context} />
          </div>
        </details>
      )}
    </div>
  );
}
