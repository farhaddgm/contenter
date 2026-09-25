import { useState } from 'react';
import { Info, Search } from 'lucide-react';
import { InteractionType, type InteractionLog } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { formatDate, formatNumber } from '@/utils/format';
import { useInteractions, useSmartConfig } from '@/features/smart/api';

export default function SmartInteractionsRoute() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const debouncedQ = useDebounce(q);
  const config = useSmartConfig();
  const { data, isLoading } = useInteractions({ page, q: debouncedQ, type });

  const columns: Column<InteractionLog>[] = [
    {
      key: 'at',
      header: t('common.createdAt'),
      cell: (i) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(i.createdAt)}
        </span>
      ),
    },
    {
      key: 'user',
      header: t('smart.interactions.user'),
      cell: (i) => <span className="text-xs">{i.user?.name ?? '—'}</span>,
    },
    {
      key: 'type',
      header: t('smart.interactions.type'),
      cell: (i) => <Badge tone={i.source === 'SERVER' ? 'primary' : 'outline'}>{i.type}</Badge>,
    },
    {
      key: 'detail',
      header: t('smart.interactions.detail'),
      cell: (i) => (
        <div className="min-w-56 max-w-lg" dir="ltr">
          <p className="truncate text-start text-xs">
            {i.method ? `${i.method} ${i.path}` : (i.target ?? i.route ?? '—')}
          </p>
          {!!i.meta && (
            <code className="line-clamp-1 text-start text-[11px] text-muted-foreground">
              {JSON.stringify(i.meta)}
            </code>
          )}
          {i.route && i.method && (
            <p className="truncate text-start text-[11px] text-muted-foreground">@ {i.route}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('smart.interactions.status'),
      cell: (i) =>
        i.statusCode ? <span className="tabular-nums text-xs">{i.statusCode}</span> : '—',
    },
    {
      key: 'duration',
      header: t('smart.interactions.duration'),
      cell: (i) =>
        i.durationMs !== null ? (
          <span className="tabular-nums text-xs">{formatNumber(i.durationMs)}ms</span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('smart.interactions.title')}
        description={t('smart.interactions.subtitle')}
      />
      {config.data && !config.data.detailedLogging && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
          <Info className="size-4 shrink-0" /> {t('smart.interactions.off')}
        </p>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b p-4">
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
          <div className="w-48">
            <Select
              dir="ltr"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              placeholder={`${t('smart.interactions.type')}: ${t('common.all')}`}
              options={InteractionType.map((s) => ({ value: s, label: s }))}
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
