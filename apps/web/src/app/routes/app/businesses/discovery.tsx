import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Search,
  Wand2,
} from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { Authorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import {
  businessKeys,
  useDiscovery,
  useSelectCandidate,
} from '@/features/businesses/api/businesses';
import { DiscoverDialog } from '@/features/businesses/components/discover-dialog';

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export default function DiscoveryRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { discoveryId = '' } = useParams();
  const { data: d, isLoading, error } = useDiscovery(discoveryId);
  const select = useSelectCandidate(discoveryId);
  const [discoverOpen, setDiscoverOpen] = useState(false);

  useTrackJob(d?.status === 'RESEARCHING' ? d.jobId : null, {
    invalidate: [businessKeys.discovery(discoveryId), businessKeys.discoveries],
  });

  if (isLoading) return <PageSpinner />;
  if (error || !d) return <Navigate to={paths.app.businesses.getHref()} replace />;

  const newResearch = (
    <Authorization policy="content:write">
      <Button variant="outline" icon={<Search />} onClick={() => setDiscoverOpen(true)}>
        {t('businesses.discover.tryAgain')}
      </Button>
    </Authorization>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to={paths.app.businesses.getHref()}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-4 ltr:hidden" />
            {t('businesses.title')}
          </Link>
        }
        title={d.keyword}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[d.status]}>{t(`enums.discoveryStatus.${d.status}`)}</Badge>
            {d.location && <span>{d.location}</span>}
            <span className="text-xs">{formatDate(d.createdAt)}</span>
          </span>
        }
        actions={newResearch}
      />

      <div className="space-y-4">
        {d.status === 'RESEARCHING' && (
          <AiWorkingBanner
            title={t('businesses.discover.researching')}
            hint={t('businesses.discover.researchingHint')}
          />
        )}

        {d.status === 'FAILED' && (
          <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">{t('businesses.discover.failed')}</p>
              {d.error && (
                <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                  {d.error}
                </p>
              )}
            </div>
          </div>
        )}

        {(d.status === 'READY' || d.status === 'USED') && (
          <>
            {d.summary && (
              <Card>
                <CardHeader title={t('businesses.discover.summary')} />
                <CardBody className="text-sm leading-7">{d.summary}</CardBody>
              </Card>
            )}

            {!d.candidates.length ? (
              <Card>
                <EmptyState
                  icon={<Building2 />}
                  title={t('businesses.discover.noCandidates')}
                  action={newResearch}
                />
              </Card>
            ) : (
              <>
                <h2 className="text-lg font-semibold">{t('businesses.discover.candidates')}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {d.candidates.map((c, i) => {
                    const chosen = d.selectedIndex === i && d.businessId;
                    return (
                      <Card key={i} className={chosen ? 'border-success/50' : undefined}>
                        <CardBody className="flex h-full flex-col gap-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="font-semibold">{c.name}</h3>
                              <p className="text-xs text-muted-foreground">
                                {[c.industry, c.location].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                              {t('businesses.discover.confidence')}
                              <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full bg-primary"
                                  style={{ width: `${Math.round(c.confidence * 100)}%` }}
                                />
                              </span>
                              {formatNumber(c.confidence * 100)}٪
                            </span>
                          </div>
                          {c.website && (
                            <a
                              href={c.website}
                              target="_blank"
                              rel="noreferrer noopener"
                              dir="ltr"
                              className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
                            >
                              {hostOf(c.website)}
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                          <p className="text-sm leading-7">{c.description}</p>
                          <p className="text-xs leading-6 text-muted-foreground">
                            <span className="font-medium">
                              {t('businesses.discover.relevance')}:{' '}
                            </span>
                            {c.relevance}
                          </p>
                          {c.sourceUrls.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                              {c.sourceUrls.slice(0, 4).map((u) => (
                                <a
                                  key={u}
                                  href={u}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-muted-foreground hover:text-primary hover:underline"
                                >
                                  {hostOf(u)}
                                </a>
                              ))}
                            </div>
                          )}
                          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                            {chosen ? (
                              <>
                                <Badge tone="success">
                                  <CheckCircle2 />
                                  {t('businesses.discover.chosen')}
                                </Badge>
                                <Button asChild size="sm" variant="outline">
                                  <Link to={paths.app.business.getHref(d.businessId!)}>
                                    {t('businesses.discover.openBusiness')}
                                  </Link>
                                </Button>
                              </>
                            ) : (
                              <Authorization policy="content:write">
                                <ConfirmationDialog
                                  tone="default"
                                  title={t('businesses.discover.chooseTitle', { name: c.name })}
                                  body={t('businesses.discover.chooseBody')}
                                  confirmLabel={t('businesses.discover.choose')}
                                  isLoading={select.isPending}
                                  trigger={
                                    <Button size="sm" icon={<Wand2 />}>
                                      {t('businesses.discover.choose')}
                                    </Button>
                                  }
                                  onConfirm={() =>
                                    select
                                      .mutateAsync(i)
                                      .then((r) => {
                                        notify.info(t('businesses.buildQueued'));
                                        navigate(paths.app.business.getHref(r.businessId));
                                      })
                                      .catch((e: Error) =>
                                        notify.error(t('common.error'), e.message),
                                      )
                                  }
                                />
                              </Authorization>
                            )}
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}

            {d.sources.length > 0 && (
              <Card>
                <CardHeader title={t('businesses.sources')} />
                <ul className="grid gap-1.5 px-5 py-4 text-xs sm:grid-cols-2">
                  {d.sources.map((s) => (
                    <li key={s.url} className="truncate">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline"
                        title={s.url}
                      >
                        {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>

      {discoverOpen && <DiscoverDialog onOpenChange={setDiscoverOpen} />}
    </>
  );
}
