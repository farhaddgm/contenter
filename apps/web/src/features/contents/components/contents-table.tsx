import { useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { calendarStateOf, effectivePlatform, type Content } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Pagination, Table, type Column } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { formatDate, formatNumber, formatRelative } from '@/utils/format';
import { TagChips } from '@/features/tags/components/tag-chip';
import { useContents } from '../api/contents';
import {
  DEFAULT_FILTERS,
  readFilters,
  toApiParams,
  writeFilters,
  type ContentFilters,
} from '../filters';
import { ContentFiltersBar } from './content-filters-panel';

export function ContentsTable({
  topicId,
  showTopic = !topicId,
}: {
  topicId?: string;
  showTopic?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  // the filters live in the URL: a filtered list can be shared, and back/forward work
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const update = (patch: Partial<ContentFilters>) =>
    setParams(writeFilters({ ...filters, ...patch }), { replace: true });
  const { data, isLoading } = useContents(toApiParams(filters, { topicId }));

  const columns: Column<Content>[] = [
    {
      key: 'title',
      header: t('topics.fields.title'),
      cell: (c) => (
        <div className="min-w-48 space-y-1">
          <p className="line-clamp-1 font-medium" dir="auto">
            {c.title}
          </p>
          {c.idea && (
            <p className="line-clamp-1 text-xs text-muted-foreground">💡 {c.idea.title}</p>
          )}
          <TagChips tags={c.tags} />
        </div>
      ),
    },
    ...(showTopic
      ? [
          {
            key: 'topic',
            header: t('contents.topic'),
            cell: (c: Content) => <span className="text-muted-foreground">{c.topic?.title}</span>,
          },
        ]
      : []),
    {
      key: 'format',
      header: t('contents.format'),
      cell: (c) => (
        <div className="space-y-1">
          <Badge tone="outline">{t(`enums.contentFormat.${c.format}`)}</Badge>
          {c.topic && (
            <p className="text-[11px] text-muted-foreground">
              {t(`enums.platform.${effectivePlatform(c, c.topic)}`)}
            </p>
          )}
        </div>
      ),
    },
    ...(topicId
      ? [
          {
            key: 'campaign',
            header: t('campaigns.one'),
            cell: (c: Content) =>
              c.campaign ? (
                <span className="text-xs" dir="auto">
                  {c.campaign.name}
                </span>
              ) : (
                '—'
              ),
          },
        ]
      : []),
    {
      key: 'status',
      header: t('common.status'),
      cell: (c) => (
        <div className="space-y-1">
          <Badge tone={statusTone[c.status]}>
            {c.status === 'GENERATING' && <Loader2 className="animate-spin" />}
            {t(`enums.contentStatus.${c.status}`)}
          </Badge>
          {c.status === 'IN_REVIEW' && c.reviewStage && (
            <p className="text-[11px] text-muted-foreground">
              {t(`enums.reviewStage.${c.reviewStage}`)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'publishing',
      header: t('calendar.publishing'),
      cell: (c) => {
        const state = calendarStateOf(c);
        return state ? (
          <div className="space-y-0.5 text-xs">
            <Badge
              tone={state === 'PUBLISHED' ? 'success' : state === 'OVERDUE' ? 'danger' : 'primary'}
            >
              {t(`calendar.state.${state}`)}
            </Badge>
            <p className="text-muted-foreground">
              {formatDate(c.publishedAt ?? c.scheduledAt, false)}
            </p>
          </div>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'score',
      header: t('contents.score'),
      cell: (c) => {
        const score = c.currentVersion?.selfCheck?.score;
        return score !== undefined ? (
          <span className="tabular-nums">{formatNumber(score, 1)}/۱۰</span>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'version',
      header: t('contents.version'),
      cell: (c) => (c.currentVersion ? formatNumber(c.currentVersion.version) : '—'),
    },
    {
      key: 'updated',
      header: t('common.updatedAt'),
      cell: (c) => (
        <span className="text-xs text-muted-foreground">{formatRelative(c.updatedAt)}</span>
      ),
    },
  ];

  return (
    <Card>
      <ContentFiltersBar
        filters={filters}
        onChange={update}
        onReset={() =>
          setParams(
            writeFilters({ ...DEFAULT_FILTERS, sort: filters.sort, order: filters.order }),
            { replace: true },
          )
        }
        topicId={topicId}
      />
      <Table
        data={data?.items}
        columns={columns}
        isLoading={isLoading}
        onRowClick={(c) => navigate(paths.app.content.getHref(c.id))}
        empty={<EmptyState title={t('contents.empty')} />}
      />
      {data && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPageChange={(page) => update({ page })}
        />
      )}
    </Card>
  );
}
