import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { ErrorSource, ErrorStatus, type AppError } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { formatNumber, formatRelative } from '@/utils/format';
import { useSmartError, useSmartErrors } from '@/features/smart/api';
import { ErrorDetail, errorStatusTone } from '@/features/smart/components/error-detail';
import { useSmart } from '@/features/smart/store';

export default function SmartErrorsRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof ErrorStatus)[number] | ''>('');
  const [source, setSource] = useState<(typeof ErrorSource)[number] | ''>('');
  const debouncedQ = useDebounce(q);
  const { data, isLoading } = useSmartErrors({ page, q: debouncedQ, status, source });
  const selectedId = params.get('id');
  const selected = useSmartError(selectedId);
  const openError = useSmart((s) => s.openError);

  const select = (id: string | null) => {
    if (id) params.set('id', id);
    else params.delete('id');
    setParams(params, { replace: true });
  };

  const columns: Column<AppError>[] = [
    {
      key: 'status',
      header: t('common.status'),
      cell: (e) => (
        <Badge tone={errorStatusTone[e.status]}>{t(`smart.errors.statusLabels.${e.status}`)}</Badge>
      ),
    },
    {
      key: 'message',
      header: t('smart.errors.title'),
      cell: (e) => (
        <div className="min-w-64 max-w-xl">
          <p className="line-clamp-2 text-sm" dir="auto">
            {e.message}
          </p>
          {(e.path || e.route) && (
            <code className="text-[11px] text-muted-foreground" dir="ltr">
              {e.method} {e.path ?? e.route}
            </code>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      header: t('smart.errors.source'),
      cell: (e) => t(`smart.errors.sourceLabels.${e.source}`),
    },
    {
      key: 'category',
      header: t('smart.errors.category'),
      cell: (e) => <Badge tone="outline">{t(`smart.errors.categoryLabels.${e.category}`)}</Badge>,
    },
    {
      key: 'count',
      header: t('smart.errors.occurrences'),
      cell: (e) => <span className="tabular-nums">×{formatNumber(e.count)}</span>,
    },
    {
      key: 'last',
      header: t('smart.errors.lastSeen'),
      cell: (e) => (
        <span className="text-xs text-muted-foreground">{formatRelative(e.lastSeenAt)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('smart.errors.title')} description={t('smart.errors.subtitle')} />
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
          <div className="w-44">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
              placeholder={`${t('common.status')}: ${t('common.all')}`}
              options={ErrorStatus.map((s) => ({
                value: s,
                label: t(`smart.errors.statusLabels.${s}`),
              }))}
            />
          </div>
          <div className="w-44">
            <Select
              value={source}
              onChange={(e) => {
                setSource(e.target.value as typeof source);
                setPage(1);
              }}
              placeholder={`${t('smart.errors.source')}: ${t('common.all')}`}
              options={ErrorSource.map((s) => ({
                value: s,
                label: t(`smart.errors.sourceLabels.${s}`),
              }))}
            />
          </div>
        </div>
        <Table
          data={data?.items}
          columns={columns}
          isLoading={isLoading}
          onRowClick={(e) => select(e.id)}
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
      {selectedId && (
        <Drawer
          open
          onOpenChange={(v) => !v && select(null)}
          title={t('smart.errors.details')}
          description={
            <code dir="ltr" className="text-xs">
              {selectedId}
            </code>
          }
        >
          {selected.isLoading || !selected.data ? (
            <PageSpinner />
          ) : (
            <ErrorDetail error={selected.data} onTalk={() => openError(selected.data!.id)} />
          )}
        </Drawer>
      )}
    </>
  );
}
