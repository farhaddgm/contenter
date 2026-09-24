import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Archive, ArchiveRestore, ChevronLeft, Pencil, PenLine, Trash2 } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageHeader, TabLinks } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { Authorization } from '@/lib/auth';
import { useDisclosure } from '@/hooks/use-disclosure';
import { formatNumber } from '@/utils/format';
import { useDeleteTopic, useTopic, useUpdateTopic } from '@/features/topics/api/topics';
import { TopicFormDrawer } from '@/features/topics/components/topic-form';
import { TopicOverview } from '@/features/topics/components/topic-overview';
import { PrinciplesList } from '@/features/principles/components/principles-list';
import { SamplesPanel } from '@/features/samples/components/samples-panel';
import { ProfilePanel } from '@/features/profiles/components/profile-panel';
import { IdeasPanel } from '@/features/ideas/components/ideas-panel';
import { ContentsTable } from '@/features/contents/components/contents-table';
import { GenerateContentDialog } from '@/features/contents/components/generate-content';

const TABS = ['overview', 'principles', 'samples', 'profile', 'ideas', 'contents'] as const;
type Tab = (typeof TABS)[number];

export default function TopicRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { topicId = '', tab = 'overview' } = useParams();
  const { data: topic, isLoading, error } = useTopic(topicId);
  const update = useUpdateTopic(topicId);
  const remove = useDeleteTopic();
  const editDrawer = useDisclosure();
  const generateDialog = useDisclosure();

  if (!TABS.includes(tab as Tab)) return <Navigate to={paths.app.topic.getHref(topicId)} replace />;
  if (isLoading) return <PageSpinner />;
  if (error || !topic) return <Navigate to={paths.app.topics.getHref()} replace />;

  const count = (n?: number) =>
    n ? (
      <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(n)}
      </span>
    ) : null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to={paths.app.topics.getHref()}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-4 ltr:hidden" />
            {t('topics.title')}
          </Link>
        }
        title={topic.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[topic.status]}>{t(`enums.topicStatus.${topic.status}`)}</Badge>
            <Badge tone="primary">{t(`enums.platform.${topic.platform}`)}</Badge>
            <Badge tone={topic.activeProfileId ? 'success' : 'neutral'}>
              {topic.activeProfileId ? t('topics.activeProfile') : t('topics.noActiveProfile')}
            </Badge>
          </span>
        }
        actions={
          <Authorization policy="content:write">
            <Button icon={<PenLine />} onClick={generateDialog.open}>
              {t('contents.generate')}
            </Button>
            <Button variant="outline" icon={<Pencil />} onClick={editDrawer.open}>
              {t('common.edit')}
            </Button>
            <Button
              variant="outline"
              icon={topic.status === 'ACTIVE' ? <Archive /> : <ArchiveRestore />}
              isLoading={update.isPending}
              onClick={() =>
                update.mutate({ status: topic.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' })
              }
            >
              {topic.status === 'ACTIVE' ? t('topics.archive') : t('topics.unarchive')}
            </Button>
            <Authorization policy="topic:delete">
              <ConfirmationDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={t('common.delete')}>
                    <Trash2 />
                  </Button>
                }
                onConfirm={() =>
                  remove.mutateAsync(topic.id).then(() => navigate(paths.app.topics.getHref()))
                }
                isLoading={remove.isPending}
              />
            </Authorization>
          </Authorization>
        }
      />

      <TabLinks
        tabs={[
          { to: paths.app.topic.getHref(topic.id), label: t('topics.tabs.overview'), end: true },
          {
            to: paths.app.topic.getHref(topic.id, 'principles'),
            label: t('topics.tabs.principles'),
          },
          {
            to: paths.app.topic.getHref(topic.id, 'samples'),
            label: t('topics.tabs.samples'),
            badge: count(topic._count?.samples),
          },
          {
            to: paths.app.topic.getHref(topic.id, 'profile'),
            label: t('topics.tabs.profile'),
            badge: count(topic._count?.profiles),
          },
          {
            to: paths.app.topic.getHref(topic.id, 'ideas'),
            label: t('topics.tabs.ideas'),
            badge: count(topic._count?.ideas),
          },
          {
            to: paths.app.topic.getHref(topic.id, 'contents'),
            label: t('topics.tabs.contents'),
            badge: count(topic._count?.contents),
          },
        ]}
      />

      {tab === 'overview' && <TopicOverview topic={topic} />}
      {tab === 'principles' && (
        <div className="space-y-3">
          <PrinciplesList
            topicId={topic.id}
            title={t('principles.title')}
            description={t('principles.subtitle')}
          />
          <p className="text-xs text-muted-foreground">
            {t('principles.inheritedGlobal')}{' '}
            <Authorization policy="backoffice:access">
              <Link
                className="text-primary hover:underline"
                to={paths.app.admin.principles.getHref()}
              >
                {t('principles.globalTitle')}
              </Link>
            </Authorization>
          </p>
        </div>
      )}
      {tab === 'samples' && <SamplesPanel topicId={topic.id} />}
      {tab === 'profile' && (
        <ProfilePanel topicId={topic.id} activeProfileId={topic.activeProfileId} />
      )}
      {tab === 'ideas' && <IdeasPanel topicId={topic.id} hasProfile={!!topic.activeProfileId} />}
      {tab === 'contents' && <ContentsTable topicId={topic.id} />}

      <TopicFormDrawer open={editDrawer.isOpen} onOpenChange={editDrawer.setIsOpen} topic={topic} />
      {generateDialog.isOpen && (
        <GenerateContentDialog topicId={topic.id} open onOpenChange={generateDialog.setIsOpen} />
      )}
    </>
  );
}
