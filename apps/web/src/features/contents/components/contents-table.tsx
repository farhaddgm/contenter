import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Search } from 'lucide-react';
import type { Content, ContentStatus } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { EmptyState, Pagination, Table, type Column } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { formatNumber, formatRelative } from '@/utils/format';
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
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const { data, isLoading } = useContents({ page, status, topicId, q: debouncedQ });

  const columns: Column<Content>[] = [
    {
      key: 'title',
      header: t('topics.fields.title'),
      cell: (c) => (
        <div className="min-w-48">
          <p className="line-clamp-1 font-medium" dir="auto">
            {c.title}
          </p>
          {c.idea && (
            <p className="line-clamp-1 text-xs text-muted-foreground">💡 {c.idea.title}</p>
          )}
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
    {
      key: 'status',
      header: t('common.status'),
      cell: (c) => (
        <Badge tone={statusTone[c.status]}>
          {c.status === 'GENERATING' && <Loader2 className="animate-spin" />}
          {t(`enums.contentStatus.${c.status}`)}
        </Badge>
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
