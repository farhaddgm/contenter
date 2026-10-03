import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Ban, BookOpen, Building2, Globe, Plus, Search, Sparkles } from 'lucide-react';
import { BusinessSectionKey, type BusinessStatus } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState, Pagination } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { Authorization } from '@/lib/auth';
import { useDebounce } from '@/hooks/use-debounce';
import { useBusinesses, useDiscoveries } from '@/features/businesses/api/businesses';
import { BusinessFormDrawer } from '@/features/businesses/components/business-form';
import { CompletenessBar } from '@/features/businesses/components/completeness-bar';
import { DiscoverDialog } from '@/features/businesses/components/discover-dialog';
import { FromSourcesDialog } from '@/features/businesses/components/from-sources-dialog';
import { BlocklistDialog } from '@/features/businesses/components/source-dialogs';
import { formatNumber, formatRelative } from '@/utils/format';

function RecentDiscoveries() {
  const t = useT();
  const { data } = useDiscoveries();
  if (!data?.length) return null;
  return (
    <Card className="mt-6">
      <CardHeader title={t('businesses.discover.recent')} />
      <ul className="divide-y">
        {data.map((d) => (
          <li key={d.id}>
            <Link
              to={paths.app.discovery.getHref(d.id)}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm transition hover:bg-muted"
            >
              <span className="flex items-center gap-2 font-medium">
                <Globe className="size-4 text-muted-foreground" />
                {d.keyword}
                {d.location && (
                  <span className="text-xs text-muted-foreground">· {d.location}</span>
                )}
              </span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                {d.status !== 'RESEARCHING' && d.status !== 'FAILED' && (
                  <span className="flex items-center gap-1">
                    <Building2 className="size-3.5" />
                    {formatNumber(d.candidates.length)}
                  </span>
                )}
                <Badge tone={statusTone[d.status]}>{t(`enums.discoveryStatus.${d.status}`)}</Badge>
                <span>{formatRelative(d.createdAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function BusinessesRoute() {
  const t = useT();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [blocklistOpen, setBlocklistOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<BusinessStatus | ''>('ACTIVE');
  const debouncedQ = useDebounce(q);
  const { data, isLoading } = useBusinesses({ page, q: debouncedQ, status, pageSize: 12 });

  const actions = (
    <Authorization policy="content:write">
      <Button icon={<Sparkles />} onClick={() => setDiscoverOpen(true)}>
        {t('businesses.autoCreate')}
      </Button>
      <Button variant="outline" icon={<BookOpen />} onClick={() => setSourcesOpen(true)}>
        {t('businesses.fromSources.open')}
      </Button>
      <Button variant="outline" icon={<Plus />} onClick={() => setFormOpen(true)}>
        {t('businesses.new')}
      </Button>
      <Button variant="ghost" icon={<Ban />} onClick={() => setBlocklistOpen(true)}>
        {t('businesses.blocklist.open')}
      </Button>
    </Authorization>
  );

  return (
    <>
      <PageHeader
        title={t('businesses.title')}
        description={t('businesses.subtitle')}
        actions={actions}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
            { value: 'ACTIVE', label: t('enums.businessStatus.ACTIVE') },
            { value: 'ARCHIVED', label: t('enums.businessStatus.ARCHIVED') },
            { value: '', label: t('common.all') },
          ]}
        />
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<Building2 />}
            title={t('businesses.empty')}
            description={t('businesses.emptyHint')}
            action={actions}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((b) => (
              <Link
                key={b.id}
                to={paths.app.business.getHref(b.id)}
                className="group flex flex-col rounded-lg border bg-card p-5 shadow-xs transition hover:border-primary/40 hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-semibold group-hover:text-primary">{b.name}</h3>
                  <Badge tone={statusTone[b.status]}>{t(`enums.businessStatus.${b.status}`)}</Badge>
                </div>
                <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                  {b.tagline || [b.industry, b.location].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {b.access === 'VIEW' && <Badge tone="outline">{t('topics.readOnly')}</Badge>}
                  <Badge tone={b.origin === 'RESEARCH' ? 'primary' : 'neutral'}>
                    {t(`enums.businessOrigin.${b.origin}`)}
                  </Badge>
                  {(b.buildState === 'BUILDING' || b.buildState === 'FAILED') && (
                    <Badge tone={statusTone[b.buildState]}>
                      {t(`enums.businessBuildState.${b.buildState}`)}
                    </Badge>
                  )}
                  {!!b.pendingSuggestions && (
                    <Badge tone="warning">
                      {t('businesses.pendingCount', { count: formatNumber(b.pendingSuggestions) })}
                    </Badge>
                  )}
                </div>
                <div className="mt-4">
                  <CompletenessBar
                    filled={b.filledSections ?? 0}
                    total={BusinessSectionKey.length}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    {t('businesses.topicsCount', { count: formatNumber(b._count?.topics ?? 0) })}
                  </span>
                  <span>{formatRelative(b.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
          <Card className="mt-4">
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onPageChange={setPage}
            />
          </Card>
        </>
      )}

      <RecentDiscoveries />

      {formOpen && (
        <BusinessFormDrawer
          onOpenChange={setFormOpen}
          onCreated={(b) => navigate(paths.app.business.getHref(b.id))}
        />
      )}
      {discoverOpen && <DiscoverDialog onOpenChange={setDiscoverOpen} />}
      {blocklistOpen && <BlocklistDialog onOpenChange={setBlocklistOpen} />}
      {sourcesOpen && <FromSourcesDialog onOpenChange={setSourcesOpen} />}
    </>
  );
}
