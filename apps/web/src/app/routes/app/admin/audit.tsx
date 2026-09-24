import { useState } from 'react';
import { Search } from 'lucide-react';
import type { AuditLog } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { formatDate } from '@/utils/format';
import { useAuditLogs } from '@/features/admin/api';

export default function AuditRoute() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const { data, isLoading } = useAuditLogs({ page, q: debouncedQ });

  const columns: Column<AuditLog>[] = [
    {
      key: 'action',
      header: t('audit.action'),
      cell: (l) => (
        <code className="text-xs" dir="ltr">
          {l.action}
        </code>
      ),
    },
    {
      key: 'entity',
      header: t('audit.entity'),
      cell: (l) => (
        <span className="flex items-center gap-2">
          <Badge tone="outline">{l.entityType}</Badge>
          {l.entityId && (
            <code className="text-[11px] text-muted-foreground" dir="ltr">
              {l.entityId.slice(0, 10)}…
            </code>
          )}
        </span>
      ),
    },
    {
      key: 'user',
      header: t('audit.user'),
      cell: (l) =>
        l.user?.name ?? <span className="text-muted-foreground">{t('audit.system')}</span>,
    },
    {
      key: 'meta',
      header: t('common.details'),
      cell: (l) =>
        l.meta ? (
          <code className="line-clamp-1 max-w-72 text-[11px] text-muted-foreground" dir="ltr">
            {JSON.stringify(l.meta)}
          </code>
        ) : (
          '—'
        ),
    },
    {
      key: 'ip',
      header: t('audit.ip'),
      cell: (l) => (
        <span className="text-xs text-muted-foreground" dir="ltr">
          {l.ip ?? '—'}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('common.createdAt'),
      cell: (l) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(l.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />
      <Card>
        <div className="border-b p-4">
          <div className="relative max-w-xs">
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
        </div>
        <Table data={data?.items} columns={columns} isLoading={isLoading} />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
    </>
  );
}
