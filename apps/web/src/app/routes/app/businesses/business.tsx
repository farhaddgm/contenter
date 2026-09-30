import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ExternalLink,
  FolderKanban,
  Globe,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { BusinessSectionKey, type BusinessSuggestion } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { Authorization, useAuthorization } from '@/lib/auth';
import { formatDate } from '@/utils/format';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import {
  businessKeys,
  useBusiness,
  useDeleteBusiness,
  useSuggestions,
  useUpdateBusiness,
} from '@/features/businesses/api/businesses';
import { BuildDialog, SuggestDialog } from '@/features/businesses/components/ai-dialogs';
import { BusinessFormDrawer } from '@/features/businesses/components/business-form';
import { AssetsPanel } from '@/features/businesses/components/assets-panel';
import { CompletenessBar } from '@/features/businesses/components/completeness-bar';
import { useDriveResultNotice } from '@/features/businesses/components/google-drive-card';
import { NotesCard } from '@/features/businesses/components/notes-card';
import { ReferencesCard } from '@/features/businesses/components/references-card';
import { SectionCard } from '@/features/businesses/components/section-card';
import { SourceList } from '@/features/businesses/components/source-dialogs';

const SOURCES_PREVIEW = 12;

export default function BusinessRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { businessId = '' } = useParams();
  const { can } = useAuthorization();
  const editable = can('content:write');
  const { data: business, isLoading, error } = useBusiness(businessId);
  const suggestions = useSuggestions(businessId);
  const update = useUpdateBusiness(businessId);
  const remove = useDeleteBusiness();

  const [formOpen, setFormOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [suggestKeys, setSuggestKeys] = useState<BusinessSectionKey[] | null>(null);
  const [suggestJob, setSuggestJob] = useState<{ id: string; keys: BusinessSectionKey[] } | null>(
    null,
  );
  const [allSources, setAllSources] = useState(false);
  const [tab, setTab] = useState<'profile' | 'references' | 'assets'>('profile');
  useDriveResultNotice();

  const invalidate = [businessKeys.one(businessId), businessKeys.suggestions(businessId)];
  const building = business?.buildState === 'BUILDING';
  useTrackJob(building ? business?.lastJobId : null, { invalidate });
  const suggestTracker = useTrackJob(suggestJob?.id, {
    invalidate,
    onDone: () => setSuggestJob(null),
  });

  const pendingByKey = useMemo(() => {
    const map = new Map<BusinessSectionKey, BusinessSuggestion[]>();
    for (const s of suggestions.data ?? []) map.set(s.key, [...(map.get(s.key) ?? []), s]);
    return map;
  }, [suggestions.data]);

  if (isLoading) return <PageSpinner />;
  if (error || !business) return <Navigate to={paths.app.businesses.getHref()} replace />;

  const sections = new Map((business.sections ?? []).map((s) => [s.key, s]));
  const emptyKeys = BusinessSectionKey.filter((k) => !sections.get(k)?.content.trim());
  const sources = allSources ? business.sources : business.sources.slice(0, SOURCES_PREVIEW);

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
        title={business.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[business.status]}>
              {t(`enums.businessStatus.${business.status}`)}
            </Badge>
            <Badge tone={business.origin === 'MANUAL' ? 'neutral' : 'primary'}>
              {t(`enums.businessOrigin.${business.origin}`)}
            </Badge>
            {business.buildState !== 'NONE' && (
              <Badge tone={statusTone[business.buildState]}>
                {t(`enums.businessBuildState.${business.buildState}`)}
              </Badge>
            )}
            {business.keyword && (
              <span className="text-xs">
                {t('businesses.keyword', { keyword: business.keyword })}
              </span>
            )}
          </span>
        }
        actions={
          <Authorization policy="content:write">
            {emptyKeys.length > 0 && (
              <Button icon={<Sparkles />} onClick={() => setSuggestKeys(emptyKeys)}>
                {t('businesses.fillEmpty')}
              </Button>
            )}
            <Button
              variant="outline"
              icon={<Globe />}
              disabled={building}
              onClick={() => setBuildOpen(true)}
            >
              {t('businesses.researchBuild')}
            </Button>
            <Button variant="outline" icon={<Pencil />} onClick={() => setFormOpen(true)}>
              {t('common.edit')}
            </Button>
            <Button
              variant="outline"
              icon={business.status === 'ACTIVE' ? <Archive /> : <ArchiveRestore />}
              isLoading={update.isPending}
              onClick={() =>
                update.mutate({ status: business.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' })
              }
            >
              {business.status === 'ACTIVE' ? t('businesses.archive') : t('businesses.unarchive')}
            </Button>
            <Authorization policy="business:delete">
              <ConfirmationDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={t('common.delete')}>
                    <Trash2 />
                  </Button>
                }
                body={t('businesses.deleteBody')}
                isLoading={remove.isPending}
                onConfirm={() =>
                  remove
                    .mutateAsync(business.id)
                    .then(() => navigate(paths.app.businesses.getHref()))
                }
              />
            </Authorization>
          </Authorization>
        }
      />

      <div className="space-y-4">
        {building && (
          <AiWorkingBanner title={t('businesses.building')} hint={t('businesses.buildingHint')} />
        )}
        {business.buildState === 'FAILED' && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">{t('businesses.buildFailed')}</p>
                {business.buildError && (
                  <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                    {business.buildError}
                  </p>
                )}
              </div>
            </div>
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setBuildOpen(true)}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <Segmented
              value={tab}
              onChange={setTab}
              options={(['profile', 'references', 'assets'] as const).map((value) => ({
                value,
                label: t(`businesses.tabs.${value}`),
              }))}
            />
            {tab === 'references' && <ReferencesCard businessId={business.id} />}
            {tab === 'assets' && <AssetsPanel businessId={business.id} />}
            {tab === 'profile' && (
              <>
                <NotesCard
                  businessId={business.id}
                  hasWebsite={!!business.website}
                  disabled={building}
                />
                <div>
                  <h2 className="text-lg font-semibold">{t('businesses.profile')}</h2>
                  <p className="text-sm text-muted-foreground">{t('businesses.profileHint')}</p>
                </div>
                {BusinessSectionKey.map((key) => (
                  <SectionCard
                    key={key}
                    businessId={business.id}
                    sectionKey={key}
                    section={sections.get(key)}
                    suggestions={pendingByKey.get(key) ?? []}
                    editable={editable}
                    suggesting={suggestTracker.isRunning && !!suggestJob?.keys.includes(key)}
                    onSuggest={(k) => setSuggestKeys([k])}
                  />
                ))}
              </>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
            <Card>
              <CardBody className="space-y-4 text-sm">
                <CompletenessBar
                  filled={BusinessSectionKey.length - emptyKeys.length}
                  total={BusinessSectionKey.length}
                />
                <dl className="space-y-2">
                  {(
                    [
                      ['tagline', business.tagline],
                      ['industry', business.industry],
                      ['location', business.location],
                    ] as const
                  ).map(([k, v]) =>
                    v ? (
                      <div key={k}>
                        <dt className="text-xs text-muted-foreground">
                          {t(`businesses.fields.${k}`)}
                        </dt>
                        <dd>{v}</dd>
                      </div>
                    ) : null,
                  )}
                  {business.website && (
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t('businesses.fields.website')}
                      </dt>
                      <dd>
                        <a
                          href={business.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          dir="ltr"
                          className="inline-flex items-center gap-1 break-all text-primary hover:underline"
                        >
                          {business.website}
                          <ExternalLink className="size-3" />
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
                {business.researchedAt && (
                  <p className="text-xs text-muted-foreground">
                    {t('businesses.researchedAt', { date: formatDate(business.researchedAt) })}
                  </p>
                )}
                <p className="rounded-md bg-primary/5 px-3 py-2 text-xs leading-6 text-primary">
                  {t('businesses.aiNote')}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title={t('businesses.linkedTopics')}
                actions={
                  editable && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('businesses.newTopic')}
                      title={t('businesses.newTopic')}
                      onClick={() =>
                        navigate(`${paths.app.topics.getHref()}?new=1&business=${business.id}`)
                      }
                    >
                      <Plus />
                    </Button>
                  )
                }
              />
              {business.topics?.length ? (
                <ul className="p-2">
                  {business.topics.map((topic) => (
                    <li key={topic.id}>
                      <Link
                        to={paths.app.topic.getHref(topic.id)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                      >
                        <FolderKanban className="size-4 text-muted-foreground" />
                        <span className="truncate">{topic.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-xs leading-6 text-muted-foreground">
                  {t('businesses.noTopics')}
                </p>
              )}
            </Card>

            {business.gaps.length > 0 && (
              <Card>
                <CardHeader title={t('businesses.gaps')} />
                <ul className="list-disc space-y-1 px-5 py-4 ps-9 text-xs leading-6">
                  {business.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </Card>
            )}

            {business.sources.length > 0 && (
              <Card>
                <CardHeader title={t('businesses.sources')} />
                <SourceList sources={sources} target={{ business: business.id }} />
                {business.sources.length > SOURCES_PREVIEW && (
                  <div className="border-t px-3 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setAllSources((v) => !v)}>
                      {allSources ? '−' : `+${business.sources.length - SOURCES_PREVIEW}`}
                    </Button>
                  </div>
                )}
              </Card>
            )}
          </aside>
        </div>
      </div>

      {formOpen && <BusinessFormDrawer business={business} onOpenChange={setFormOpen} />}
      {buildOpen && (
        <BuildDialog
          businessId={business.id}
          hasWebsite={!!business.website}
          onOpenChange={setBuildOpen}
        />
      )}
      {suggestKeys && (
        <SuggestDialog
          businessId={business.id}
          hasWebsite={!!business.website}
          initialKeys={suggestKeys}
          emptyKeys={emptyKeys}
          onQueued={(id, keys) => setSuggestJob({ id, keys })}
          onOpenChange={(v) => !v && setSuggestKeys(null)}
        />
      )}
    </>
  );
}
