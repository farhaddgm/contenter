import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Loader2, Search } from 'lucide-react';
import type { Content, ContentStatus } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { EmptyState, Pagination, Table, type Column } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { formatNumber, formatRelative } from '@/utils/format';
import { useCampaigns } from '@/features/campaigns/api/campaigns';
import { useTags } from '@/features/tags/api/tags';
import { TagChips } from '@/features/tags/components/tag-chip';
import { useContents } from '../api/contents';

export function ContentsTable({
  topicId,
  showTopic = !topicId,
}: {
  topicId?: string;
  showTopic?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  // a campaign card links here with `?campaign=<id>`; the filters then live in local state
  const [search] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [tagId, setTagId] = useState(search.get('tag') ?? '');
  const [campaignId, setCampaignId] = useState(search.get('campaign') ?? '');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const tags = useTags(topicId);
  const campaigns = useCampaigns(topicId);
  const { data, isLoading } = useContents({
    page,
    status,
    topicId,
    tagId,
    campaignId,
    q: debouncedQ,
  });

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
      cell: (c) => <Badge tone="outline">{t(`enums.contentFormat.${c.format}`)}</Badge>,
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
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="relative w-full max-w-xs">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t('common.search')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Segmented
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: t('common.all') },
            { value: 'DRAFT', label: t('enums.contentStatus.DRAFT') },
            { value: 'IN_REVIEW', label: t('enums.contentStatus.IN_REVIEW') },
            { value: 'APPROVED', label: t('enums.contentStatus.APPROVED') },
            { value: 'REJECTED', label: t('enums.contentStatus.REJECTED') },
          ]}
        />
        {!!tags.data?.length && (
          <Select
            className="h-9 w-44"
            aria-label={t('tags.one')}
            placeholder={t('tags.allTags')}
            value={tagId}
            onChange={(e) => {
              setTagId(e.target.value);
              setPage(1);
            }}
            options={tags.data.map((tag) => ({ value: tag.id, label: tag.name }))}
          />
        )}
        {!!campaigns.data?.length && (
          <Select
            className="h-9 w-44"
            aria-label={t('campaigns.one')}
            placeholder={t('campaigns.allCampaigns')}
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              setPage(1);
            }}
            options={campaigns.data.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </div>
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
          onPageChange={setPage}
        />
      )}
    </Card>
  );
}
