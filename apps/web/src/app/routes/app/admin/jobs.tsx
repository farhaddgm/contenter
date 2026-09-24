import { useState } from 'react';
import { Ban, RotateCw } from 'lucide-react';
import { AiJobStatus, AiJobType, type AiJob } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, StatCard } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form-controls';
import { JsonView, PageHeader } from '@/components/ui/misc';
import { Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatRelative,
  formatUsd,
} from '@/utils/format';
import { useCancelJob, useJobs, useQueueStats, useRetryJob } from '@/features/jobs/api/jobs';
import { JobStatusBadge } from '@/features/jobs/components/job-status';

function JobDetails({ job, onClose }: { job: AiJob | null; onClose: () => void }) {
  const t = useT();
  const retry = useRetryJob();
  const cancel = useCancelJob();
  if (!job) return null;
  const rows: [string, React.ReactNode][] = [
    [t('jobs.type'), t(`enums.jobType.${job.type}`)],
    [t('common.status'), <JobStatusBadge key="s" status={job.status} />],
    [
      t('jobs.target'),
      <code key="tg" className="text-xs" dir="ltr">
        {job.targetType}:{job.targetId}
      </code>,
    ],
    [
      t('jobs.model'),
      <span key="m" dir="ltr">
        {job.model ?? '—'}
      </span>,
    ],
    [t('jobs.prompt'), job.promptKey ? `${job.promptKey} v${job.promptVersion}` : '—'],
    [
      t('jobs.tokens'),
      `${formatNumber(job.inputTokens)} / ${formatNumber(job.outputTokens)}${job.cacheReadTokens ? ` (cache ${formatNumber(job.cacheReadTokens)})` : ''}`,
    ],
    [t('jobs.cost'), formatUsd(job.costUsd)],
    [t('jobs.attempts'), formatNumber(job.attempts)],
    [t('jobs.duration'), formatDuration(job.startedAt, job.finishedAt)],
    [t('jobs.createdBy'), job.createdBy?.name ?? '—'],
    [t('common.createdAt'), formatDate(job.createdAt)],
  ];
  return (
    <Drawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={t(`enums.jobType.${job.type}`)}
      description={
        <code dir="ltr" className="text-xs">
          {job.id}
        </code>
      }
      footer={
        <>
          {job.status === 'QUEUED' && (
            <Button
              variant="outline"
              icon={<Ban />}
              isLoading={cancel.isPending}
              onClick={() => cancel.mutate(job.id, { onSuccess: onClose })}
            >
              {t('jobs.cancel')}
            </Button>
          )}
          {(job.status === 'FAILED' || job.status === 'CANCELED') && (
            <Button
              icon={<RotateCw />}
              isLoading={retry.isPending}
              onClick={() =>
                retry.mutate(job.id, {
                  onSuccess: () => {
                    notify.success(t('jobs.retried'));
                    onClose();
                  },
                })
              }
            >
              {t('jobs.retry')}
            </Button>
          )}
        </>
      }
    >
      <dl className="mb-6 divide-y rounded-lg border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-end">{v}</dd>
          </div>
        ))}
      </dl>
      {job.error && (
        <div className="mb-6">
          <h4 className="mb-2 text-sm font-semibold text-destructive">{t('jobs.error')}</h4>
          <p className="rounded-md bg-destructive/10 p-3 text-sm" dir="auto">
            {job.error}
          </p>
        </div>
      )}
      <h4 className="mb-2 text-sm font-semibold">{t('jobs.input')}</h4>
      <JsonView value={job.input} />
      <h4 className="mb-2 mt-6 text-sm font-semibold">{t('jobs.output')}</h4>
      <JsonView value={job.output} />
    </Drawer>
  );
}

export default function JobsRoute() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof AiJobStatus)[number] | ''>('');
  const [type, setType] = useState<(typeof AiJobType)[number] | ''>('');
  const [selected, setSelected] = useState<AiJob | null>(null);
  const { data, isLoading } = useJobs({ page, status, type });
  const queue = useQueueStats();

  const columns: Column<AiJob>[] = [
    {
      key: 'type',
      header: t('jobs.type'),
      cell: (j) => <span className="font-medium">{t(`enums.jobType.${j.type}`)}</span>,
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (j) => <JobStatusBadge status={j.status} />,
    },
    {
      key: 'model',
      header: t('jobs.model'),
      cell: (j) => (
        <span className="text-xs text-muted-foreground" dir="ltr">
          {j.model ?? '—'}
        </span>
      ),
    },
    {
      key: 'tokens',
      header: t('jobs.tokens'),
      cell: (j) => (
        <span className="tabular-nums text-xs">
          {formatNumber(j.inputTokens)} / {formatNumber(j.outputTokens)}
        </span>
      ),
    },
    {
      key: 'cost',
      header: t('jobs.cost'),
      cell: (j) => <span className="tabular-nums">{formatUsd(j.costUsd)}</span>,
    },
    {
      key: 'duration',
      header: t('jobs.duration'),
      cell: (j) => <span className="text-xs">{formatDuration(j.startedAt, j.finishedAt)}</span>,
    },
    {
      key: 'by',
      header: t('jobs.createdBy'),
      cell: (j) => <span className="text-xs">{j.createdBy?.name ?? '—'}</span>,
    },
    {
      key: 'created',
      header: t('common.createdAt'),
      cell: (j) => (
        <span className="text-xs text-muted-foreground">{formatRelative(j.createdAt)}</span>
      ),
    },
  ];

  const q = queue.data;
  return (
    <>
      <PageHeader title={t('jobs.title')} description={t('jobs.subtitle')} />
      {q && q.driver === 'bullmq' && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard
            label={t('jobs.waiting')}
            value={formatNumber(Number(q.waiting))}
            tone="warning"
          />
          <StatCard label={t('jobs.active')} value={formatNumber(Number(q.active))} />
          <StatCard
            label={t('jobs.delayed')}
            value={formatNumber(Number(q.delayed))}
            tone="muted"
          />
          <StatCard label={t('jobs.failed')} value={formatNumber(Number(q.failed))} tone="muted" />
          <StatCard
            label={t('jobs.completed')}
            value={formatNumber(Number(q.completed))}
            tone="success"
          />
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="w-48">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
              placeholder={`${t('common.status')}: ${t('common.all')}`}
              options={AiJobStatus.map((s) => ({ value: s, label: t(`enums.jobStatus.${s}`) }))}
            />
          </div>
          <div className="w-48">
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setPage(1);
              }}
              placeholder={`${t('jobs.type')}: ${t('common.all')}`}
              options={AiJobType.map((s) => ({ value: s, label: t(`enums.jobType.${s}`) }))}
            />
          </div>
        </div>
        <Table
          data={data?.items}
          columns={columns}
          isLoading={isLoading}
          onRowClick={setSelected}
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
      <JobDetails job={selected} onClose={() => setSelected(null)} />
    </>
  );
}
