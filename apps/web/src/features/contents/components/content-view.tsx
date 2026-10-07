import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CheckCircle2,
  ChevronLeft,
  History,
  Layers,
  MessageSquareText,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  effectivePlatform,
  type Content,
  type ContentVersion,
  type TermIssue,
} from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { CopyButton, MarkdownView, PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { useJob } from '@/features/jobs/api/jobs';
import { useCampaigns } from '@/features/campaigns/api/campaigns';
import { SchedulePanel } from '@/features/calendar/components/schedule-panel';
import { useSetContentTags } from '@/features/tags/api/tags';
import { CommentsCard } from './comments-card';
import { RepurposeDialog, RepurposedCard } from './repurpose';
import { ReviewActionButtons, ReviewTimelineCard } from './review-panel';
import { TagPicker } from '@/features/tags/components/tag-picker';
import {
  useContent,
  useDeleteContent,
  useEditContent,
  useRestoreVersion,
  useReviseContent,
  useUpdateContent,
} from '../api/contents';

function fullText(v: ContentVersion) {
  return [v.title, '', v.body, '', v.cta, '', v.hashtags.join(' ')]
    .filter((x) => x !== undefined)
    .join('\n')
    .trim();
}

function ReviseDialog({
  contentId,
  open,
  onOpenChange,
}: {
  contentId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const revise = useReviseContent(contentId);
  const [feedback, setFeedback] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('contents.revise')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Send />}
            disabled={feedback.trim().length < 3}
            isLoading={revise.isPending}
            onClick={() =>
              revise.mutate(feedback.trim(), {
                onSuccess: () => {
                  notify.info(t('contents.reviseQueued'));
                  onOpenChange(false);
                },
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            {t('contents.revise')}
          </Button>
        </>
      }
    >
      <Field label={t('contents.feedback')} hint={t('contents.feedbackHint')}>
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function EditDrawer({
  content,
  open,
  onOpenChange,
}: {
  content: Content;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const edit = useEditContent(content.id);
  const v = content.currentVersion;
  const [title, setTitle] = useState(v?.title ?? '');
  const [body, setBody] = useState(v?.body ?? '');
  const [hashtags, setHashtags] = useState(v?.hashtags.join(' ') ?? '');
  const [cta, setCta] = useState(v?.cta ?? '');
  const [notes, setNotes] = useState(v?.notes ?? '');
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('contents.editManually')}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            isLoading={edit.isPending}
            disabled={!title.trim() || !body.trim()}
            onClick={() =>
              edit.mutate(
                { title, body, hashtags: hashtags.split(/\s+/).filter(Boolean), cta, notes },
                {
                  onSuccess: () => {
                    notify.success(t('common.saved'));
                    onOpenChange(false);
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('topics.fields.title')}>
          {(id) => (
            <Input id={id} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <Field label={t('contents.body')}>
          {(id) => (
            <Textarea
              id={id}
              dir="auto"
              rows={16}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('contents.hashtags')} hint={t('contents.hashtagsHint')}>
          {(id) => (
            <Input
              id={id}
              dir="auto"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('contents.cta')}>
          {(id) => (
            <Input id={id} dir="auto" value={cta} onChange={(e) => setCta(e.target.value)} />
          )}
        </Field>
        <Field label={t('contents.notes')}>
          {(id) => (
            <Textarea
              id={id}
              dir="auto"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Drawer>
  );
}

/** Brand glossary violations of the current version, found by code on the server (checkTerms). */
function TermIssuesCard({
  contentId,
  issues,
  canFix,
}: {
  contentId: string;
  issues: TermIssue[];
  /** The user may revise and no generation is running. */
  canFix: boolean;
}) {
  const t = useT();
  const revise = useReviseContent(contentId);
  if (!issues.length) return null;
  const line = (i: TermIssue) =>
    t(`businesses.termIssue.${i.kind}`, {
      found: i.found,
      term: i.term,
      count: formatNumber(i.count),
    });
  // One revision with every violation as feedback; the glossary itself also reaches the model.
  const fix = () =>
    revise.mutate(
      [
        t('contents.termFixFeedback'),
        ...issues.map(
          (i) =>
            `- ${line(i)}${i.kind === 'AVOID' && i.replaceWith.length ? ` — ${t('businesses.termIssue.replace', { list: i.replaceWith.join('، ') })}` : ''}`,
        ),
      ].join('\n'),
      {
        onSuccess: () => notify.info(t('contents.reviseQueued')),
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );
  return (
    <Card className="border-warning/50">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            {t('contents.termIssues')}
          </span>
        }
        description={t('contents.termIssuesHint')}
      />
      <CardBody className="space-y-3">
        <ul className="space-y-1.5 text-sm">
          {issues.map((i, n) => (
            <li key={n} className="rounded-md bg-warning/10 px-3 py-1.5 leading-6">
              {line(i)}
              {i.kind === 'AVOID' && i.replaceWith.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {' '}
                  · {t('businesses.termIssue.replace', { list: i.replaceWith.join('، ') })}
                </span>
              )}
            </li>
          ))}
        </ul>
        {canFix && (
          <Button
            size="sm"
            variant="outline"
            icon={<Send />}
            isLoading={revise.isPending}
            onClick={fix}
          >
            {t('contents.termFix')}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function SelfCheckCard({ version }: { version: ContentVersion }) {
  const t = useT();
  const sc = version.selfCheck;
  if (!sc) return null;
  const pct = Math.round((sc.score / 10) * 100);
  return (
    <Card>
      <CardHeader title={t('contents.selfCheck')} />
      <CardBody className="space-y-4">
        <div className="flex items-center gap-4">
          <div
            className="relative flex size-16 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(var(--primary) ${pct}%, var(--muted) 0)` }}
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-card text-lg font-bold tabular-nums">
              {formatNumber(sc.score, 1)}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('contents.score')} / ۱۰</p>
        </div>
        <ul className="space-y-2 text-sm">
          {sc.principles.map((p, i) => (
            <li key={i} className="flex gap-2">
              {p.satisfied ? (
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-1 size-4 shrink-0 text-destructive" />
              )}
              <div>
                <p className="font-medium leading-6">{p.principle}</p>
                {p.note && <p className="text-xs leading-5 text-muted-foreground">{p.note}</p>}
              </div>
            </li>
          ))}
        </ul>
        {sc.suggestions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              {t('contents.suggestions')}
            </p>
            <ul className="list-disc space-y-1 ps-5 text-sm leading-6">
              {sc.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Tags and campaign of a content. */
function OrganizeCard({ content, editable }: { content: Content; editable: boolean }) {
  const t = useT();
  const setTags = useSetContentTags(content.id);
  const update = useUpdateContent(content.id);
  const { data: campaigns = [] } = useCampaigns(content.topicId);
  // archived campaigns stay selectable only for a content that is already in one
  const options = campaigns
    .filter((c) => c.status === 'ACTIVE' || c.id === content.campaignId)
    .map((c) => ({ value: c.id, label: c.name }));
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  return (
    <Card>
      <CardHeader title={t('contents.organize')} />
      <CardBody className="space-y-4">
        <Field label={t('tags.title')}>
          {() => (
            <TagPicker
              topicId={content.topicId}
              selected={content.tags ?? []}
              disabled={!editable}
              onChange={(tagIds) => setTags.mutate({ tagIds }, { onError })}
            />
          )}
        </Field>
        <Field label={t('campaigns.one')}>
          {(id) => (
            <Select
              id={id}
              disabled={!editable}
              placeholder={t('campaigns.none')}
              value={content.campaignId ?? ''}
              options={options}
              onChange={(e) => update.mutate({ campaignId: e.target.value || null }, { onError })}
            />
          )}
        </Field>
      </CardBody>
    </Card>
  );
}

export function ContentView({ contentId }: { contentId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: content, isLoading } = useContent(contentId);
  const editable = useCanEditTopic(content?.topicId);
  const lastJob = useJob(
    content?.status === 'FAILED' || content?.status === 'GENERATING' ? content.lastJobId : null,
  );
  const restore = useRestoreVersion(contentId);
  const remove = useDeleteContent();
  const reviseDialog = useDisclosure();
  const editDrawer = useDisclosure();
  const repurposeDialog = useDisclosure();
  // A picked history entry is tied to the current version it was picked under,
  // so a new generation automatically brings the view back to the latest draft.
  const [viewed, setViewed] = useState<{ current: string | null; id: string } | null>(null);
  const setViewVersionId = (id: string) =>
    setViewed({ current: content?.currentVersionId ?? null, id });

  if (isLoading || !content) return <PageSpinner />;

  const viewVersionId = viewed && viewed.current === content.currentVersionId ? viewed.id : null;
  const version =
    content.versions?.find((v) => v.id === viewVersionId) ?? content.currentVersion ?? null;
  const isCurrent = version?.id === content.currentVersionId;
  const generating = content.status === 'GENERATING';
  // a published content is frozen until it is unpublished
  const frozen = !!content.publishedAt;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to={paths.app.topic.getHref(content.topicId, 'contents')}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-4 ltr:hidden" />
            {content.topic?.title}
          </Link>
        }
        title={<span dir="auto">{content.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[content.status]}>
              {t(`enums.contentStatus.${content.status}`)}
            </Badge>
            {content.status === 'IN_REVIEW' && content.reviewStage && (
              <Badge tone="warning">{t(`enums.reviewStage.${content.reviewStage}`)}</Badge>
            )}
            <Badge tone="outline">{t(`enums.contentFormat.${content.format}`)}</Badge>
            {content.topic && (
              <Badge tone="primary">
                {t(`enums.platform.${effectivePlatform(content, content.topic)}`)}
              </Badge>
            )}
            {content.idea && <span className="text-xs">💡 {content.idea.title}</span>}
          </span>
        }
        actions={
          editable &&
          version && (
            <>
              <Button
                variant="outline"
                icon={<MessageSquareText />}
                onClick={reviseDialog.open}
                disabled={generating || frozen}
              >
                {t('contents.revise')}
              </Button>
              <Button
                variant="outline"
                icon={<Pencil />}
                onClick={editDrawer.open}
                disabled={generating || frozen}
              >
                {t('contents.editManually')}
              </Button>
              <Button
                variant="outline"
                icon={<Layers />}
                onClick={repurposeDialog.open}
                disabled={generating}
              >
                {t('repurpose.action')}
              </Button>
              {!generating && <ReviewActionButtons content={content} />}
              <ConfirmationDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={t('common.delete')}>
                    <Trash2 />
                  </Button>
                }
                onConfirm={() =>
                  remove
                    .mutateAsync(content.id)
                    .then(() => navigate(paths.app.topic.getHref(content.topicId, 'contents')))
                }
              />
            </>
          )
        }
      />

      {generating && (
        <div className="mb-4">
          <AiWorkingBanner title={t('contents.generating')} hint={t('contents.generatingHint')} />
        </div>
      )}
      {content.status === 'FAILED' && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" /> {t('contents.failed')}
          </p>
          {lastJob.data?.error && (
            <p className="mt-1 text-muted-foreground" dir="auto">
              {lastJob.data.error}
            </p>
          )}
        </Card>
      )}

      {version ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {t('contents.version')} {formatNumber(version.version)}
                    {isCurrent && <Badge tone="primary">{t('contents.current')}</Badge>}
                    <Badge tone="neutral">
                      {version.source === 'AI' ? t('contents.sourceAi') : t('contents.sourceAdmin')}
                    </Badge>
                  </span>
                }
                description={
                  version.feedback
                    ? t('contents.feedbackOf', { feedback: version.feedback })
                    : formatDate(version.createdAt)
                }
                actions={
                  <>
                    <CopyButton text={fullText(version)} label={t('contents.copyAll')} />
                    {!isCurrent && editable && !frozen && (
                      <Button
                        size="sm"
                        icon={<RotateCcw />}
                        isLoading={restore.isPending}
                        onClick={() => restore.mutate(version.id)}
                      >
                        {t('contents.restore')}
                      </Button>
                    )}
                  </>
                }
              />
              <CardBody>
                <h2 className="mb-3 text-xl font-bold" dir="auto">
                  {version.title}
                </h2>
                <MarkdownView>{version.body}</MarkdownView>
                {version.cta && (
                  <p
                    className="mt-4 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
                    dir="auto"
                  >
                    👉 {version.cta}
                  </p>
                )}
                {version.hashtags.length > 0 && (
                  <p className="mt-4 flex flex-wrap gap-2 text-sm text-primary" dir="auto">
                    {version.hashtags.map((h) => (
                      <span key={h}>{h.startsWith('#') ? h : `#${h}`}</span>
                    ))}
                  </p>
                )}
              </CardBody>
            </Card>
            {version.notes && (
              <Card>
                <CardHeader title={t('contents.notes')} />
                <CardBody>
                  <MarkdownView className="text-sm text-muted-foreground">
                    {version.notes}
                  </MarkdownView>
                </CardBody>
              </Card>
            )}
            <CommentsCard
              contentId={content.id}
              currentVersionId={content.currentVersionId}
              viewedVersionId={version.id}
              canWrite={editable && !generating}
            />
          </div>

          <div className="space-y-4">
            <ReviewTimelineCard content={content} />
            <Card>
              <CardHeader title={t('calendar.publishing')} />
              <CardBody>
                <SchedulePanel content={content} editable={editable} />
              </CardBody>
            </Card>
            <RepurposedCard content={content} />
            <OrganizeCard content={content} editable={editable} />
            {version.id === content.currentVersionId && (
              <TermIssuesCard
                contentId={content.id}
                issues={content.termIssues ?? []}
                canFix={editable && !generating && !frozen}
              />
            )}
            <SelfCheckCard version={version} />
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <History className="size-4" />
                    {t('contents.versions')}
                  </span>
                }
              />
              <ul className="max-h-96 overflow-y-auto p-2">
                {content.versions?.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => setViewVersionId(v.id)}
                      className={cn(
                        'w-full rounded-md px-3 py-2 text-start text-sm transition',
                        v.id === version.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span className="font-medium">
                          {t('contents.version')} {formatNumber(v.version)}
                        </span>
                        {v.id === content.currentVersionId && (
                          <Badge tone="primary">{t('contents.current')}</Badge>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {v.source === 'AI' ? t('contents.sourceAi') : t('contents.sourceAdmin')} ·{' '}
                        {formatDate(v.createdAt)}
                      </span>
                      {v.feedback && (
                        <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                          «{v.feedback}»
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      ) : (
        !generating && content.status !== 'FAILED' && <PageSpinner />
      )}

      {reviseDialog.isOpen && (
        <ReviseDialog contentId={content.id} open onOpenChange={reviseDialog.setIsOpen} />
      )}
      {repurposeDialog.isOpen && (
        <RepurposeDialog content={content} onClose={repurposeDialog.close} />
      )}
      {editDrawer.isOpen && (
        <EditDrawer content={content} open onOpenChange={editDrawer.setIsOpen} />
      )}
    </>
  );
}
