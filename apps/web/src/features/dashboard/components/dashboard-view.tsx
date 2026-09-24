import { Link } from 'react-router';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CircleDollarSign,
  FileText,
  FolderKanban,
  Layers,
  Lightbulb,
  Link2,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { ContentStatus } from '@contenter/shared';
import { ContentStatus as ContentStatuses } from '@contenter/shared';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { Authorization, useAuthorization } from '@/lib/auth';
import { useDashboard } from '@/features/admin/api';
import { JobStatusBadge } from '@/features/jobs/components/job-status';
import { formatNumber, formatRelative, formatUsd } from '@/utils/format';
import { useUi } from '@/stores/ui';

const statusColor: Record<ContentStatus, string> = {
  GENERATING: 'bg-primary',
  DRAFT: 'bg-muted-foreground/50',
  IN_REVIEW: 'bg-warning',
  APPROVED: 'bg-success',
  REJECTED: 'bg-destructive',
  FAILED: 'bg-destructive/60',
};

export function DashboardView() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const { can } = useAuthorization();
  const { data, isLoading } = useDashboard();
  if (isLoading || !data) return <PageSpinner />;

  const totalContents = Object.values(data.contentsByStatus).reduce((a, b) => a + b, 0);
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(d));

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
        actions={
          <Authorization policy="content:write">
            <Button asChild>
              <Link to={`${paths.app.topics.getHref()}?new=1`}>
                <Plus /> {t('dashboard.newTopic')}
              </Link>
            </Button>
          </Authorization>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('dashboard.topics')}
          value={formatNumber(data.counts.topics)}
          icon={<FolderKanban />}
        />
        <StatCard
          label={t('dashboard.samples')}
          value={formatNumber(data.counts.samples)}
          icon={<Link2 />}
          tone="muted"
        />
        <StatCard
          label={t('dashboard.profiles')}
          value={formatNumber(data.counts.profiles)}
          icon={<Layers />}
          tone="muted"
        />
        <StatCard
          label={t('dashboard.ideas')}
          value={formatNumber(data.counts.ideas)}
          icon={<Lightbulb />}
          tone="warning"
        />
        <StatCard
          label={t('dashboard.contents')}
          value={formatNumber(data.counts.contents)}
          icon={<FileText />}
          tone="success"
        />
        <StatCard
          label={t('dashboard.aiCost')}
          value={formatUsd(data.jobs.totalCostUsd)}
          icon={<CircleDollarSign />}
        />
      </div>

      {data.counts.topics === 0 && (
        <Card className="mt-6 border-dashed">
          <EmptyState
            icon={<Sparkles />}
            title={t('dashboard.quickStart')}
            description={t('dashboard.quickStartBody')}
            action={
              <Authorization policy="content:write">
                <Button asChild>
                  <Link to={`${paths.app.topics.getHref()}?new=1`}>
                    <Plus /> {t('dashboard.newTopic')}
                  </Link>
                </Button>
              </Authorization>
            }
          />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('dashboard.activity')} />
          <CardBody className="h-72 px-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gJobs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gContents" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={dayLabel}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  reversed={lang === 'fa'}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                  orientation={lang === 'fa' ? 'right' : 'left'}
                />
                <Tooltip
                  labelFormatter={(d) => dayLabel(String(d))}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="jobs"
                  name={t('dashboard.jobsSeries')}
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#gJobs)"
                />
                <Area
                  type="monotone"
                  dataKey="contents"
                  name={t('dashboard.contentsSeries')}
                  stroke="var(--success)"
                  strokeWidth={2}
                  fill="url(#gContents)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('dashboard.contentPipeline')} />
          <CardBody className="space-y-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {ContentStatuses.map((s) =>
                data.contentsByStatus[s] ? (
                  <div
                    key={s}
                    className={statusColor[s]}
                    style={{ width: `${(data.contentsByStatus[s] / totalContents) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <ul className="space-y-2 text-sm">
              {ContentStatuses.map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-full ${statusColor[s]}`} />
                    {t(`enums.contentStatus.${s}`)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(data.contentsByStatus[s] ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('dashboard.recentJobs')}
            actions={
              can('backoffice:access') && (
                <Button variant="ghost" size="sm" asChild>
                  <Link to={paths.app.admin.jobs.getHref()}>{t('common.view')}</Link>
                </Button>
              )
            }
          />
          {data.recentJobs.length ? (
            <ul className="divide-y">
              {data.recentJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{t(`enums.jobType.${j.type}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(j.createdAt)}
                      {j.createdBy && ` · ${j.createdBy.name}`}
                    </p>
                  </div>
                  <JobStatusBadge status={j.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('common.noData')} />
          )}
        </Card>

        <Card>
          <CardHeader title={t('dashboard.byType')} />
          {data.jobs.byType.length ? (
            <ul className="divide-y">
              {data.jobs.byType.map((r) => (
                <li
                  key={r.type}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{t(`enums.jobType.${r.type}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(r.inputTokens + r.outputTokens)} {t('dashboard.tokens')}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="font-semibold tabular-nums">{formatUsd(r.costUsd)}</p>
                    <p className="text-xs text-muted-foreground">×{formatNumber(r.count)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('common.noData')} />
          )}
        </Card>
      </div>
    </>
  );
}
