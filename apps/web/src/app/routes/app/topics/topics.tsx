import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Building2, FolderKanban, Plus, Search } from 'lucide-react';
import type { TopicStatus } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState, Pagination } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { Authorization } from '@/lib/auth';
import { useDebounce } from '@/hooks/use-debounce';
import { useDisclosure } from '@/hooks/use-disclosure';
import { useTopics } from '@/features/topics/api/topics';
import { TopicFormDrawer } from '@/features/topics/components/topic-form';
import { formatNumber, formatRelative } from '@/utils/format';

export default function TopicsRoute() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const drawer = useDisclosure(params.get('new') === '1');
  // Captured once: the URL params are cleared right after the drawer opens.
  const [newForBusiness] = useState(() => params.get('business'));
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TopicStatus | ''>('ACTIVE');
  const debouncedQ = useDebounce(q);
  const { data, isLoading } = useTopics({ page, q: debouncedQ, status, pageSize: 12 });

  useEffect(() => {
    if (params.get('new') === '1') {
      params.delete('new');
      params.delete('business');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  return (
    <>
      <PageHeader
        title={t('topics.title')}
        description={t('topics.subtitle')}
        actions={
          <Authorization policy="content:write">
            <Button icon={<Plus />} onClick={drawer.open}>
              {t('topics.new')}
            </Button>
          </Authorization>
        }
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
            { value: 'ACTIVE', label: t('enums.topicStatus.ACTIVE') },
            { value: 'ARCHIVED', label: t('enums.topicStatus.ARCHIVED') },
            { value: '', label: t('common.all') },
          ]}
        />
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title={t('topics.empty')}
            description={t('topics.emptyHint')}
            action={
              <Authorization policy="content:write">
                <Button icon={<Plus />} onClick={drawer.open}>
                  {t('topics.new')}
                </Button>
              </Authorization>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((topic) => (
              <Link
                key={topic.id}
                to={paths.app.topic.getHref(topic.id)}
                className="group rounded-lg border bg-card p-5 shadow-xs transition hover:border-primary/40 hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-semibold group-hover:text-primary">
                    {topic.title}
                  </h3>
                  <Badge tone={statusTone[topic.status]}>
                    {t(`enums.topicStatus.${topic.status}`)}
                  </Badge>
                </div>
                <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-muted-foreground">
                  {topic.description}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{t(`enums.platform.${topic.platform}`)}</Badge>
                  {topic.business && (
                    <Badge tone="outline">
                      <Building2 />
                      {topic.business.name}
                    </Badge>
                  )}
                  {topic.activeProfileId ? (
                    <Badge tone="success">{t('topics.activeProfile')}</Badge>
                  ) : (
                    <Badge tone="neutral">{t('topics.noActiveProfile')}</Badge>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    {t('topics.counts', {
                      samples: formatNumber(topic._count?.samples),
                      ideas: formatNumber(topic._count?.ideas),
                      contents: formatNumber(topic._count?.contents),
                    })}
                  </span>
                  <span>{formatRelative(topic.updatedAt)}</span>
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

      <TopicFormDrawer
        open={drawer.isOpen}
        onOpenChange={drawer.setIsOpen}
        defaultBusinessId={newForBusiness}
        onCreated={(topic) => navigate(paths.app.topic.getHref(topic.id, 'samples'))}
      />
    </>
  );
}
