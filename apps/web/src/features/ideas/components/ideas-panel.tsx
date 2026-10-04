import { useState } from 'react';
import { Lightbulb, PenLine, RotateCcw, Sparkles, Star, ThumbsDown, Trash2 } from 'lucide-react';
import { ContentFormat, type Idea, type IdeaStatus } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState, Pagination } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { GenerateContentDialog } from '@/features/contents/components/generate-content';
import { ideaKeys, useDeleteIdea, useIdeas, useIdeate, useUpdateIdea } from '../api/ideas';

function IdeateDialog({
  topicId,
  open,
  onOpenChange,
  onQueued,
}: {
  topicId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onQueued: (jobId: string) => void;
}) {
  const t = useT();
  const ideate = useIdeate(topicId);
  const [count, setCount] = useState(5);
  const [direction, setDirection] = useState('');
  const [format, setFormat] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('ideas.generate')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Sparkles />}
            isLoading={ideate.isPending}
            onClick={() =>
              ideate.mutate(
                {
                  count,
                  direction,
                  format: (format || undefined) as (typeof ContentFormat)[number] | undefined,
                },
                {
                  onSuccess: (r) => {
                    notify.info(t('ideas.queued'));
                    onQueued(r.jobId);
                    onOpenChange(false);
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('ideas.generate')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ideas.count')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              />
            )}
          </Field>
          <Field label={t('ideas.format')}>
            {(id) => (
              <Select
                id={id}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                placeholder={t('ideas.anyFormat')}
                options={ContentFormat.map((f) => ({
                  value: f,
                  label: t(`enums.contentFormat.${f}`),
                }))}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('ideas.direction')}
          hint={t('ideas.directionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function IdeaCard({ idea, onWrite }: { idea: Idea; onWrite: (i: Idea) => void }) {
  const t = useT();
  const editable = useCanEditTopic(idea.topicId);
  const update = useUpdateIdea();
  const remove = useDeleteIdea();
  const setStatus = (status: IdeaStatus) => update.mutate({ id: idea.id, data: { status } });
  return (
    <Card className={cn('flex flex-col', idea.status === 'REJECTED' && 'opacity-60')}>
      <div className="flex-1 space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-7">{idea.title}</h3>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold">
            <Star className="size-3 fill-warning text-warning" />
            {formatNumber(idea.score, 1)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary">{t(`enums.contentFormat.${idea.format}`)}</Badge>
          <Badge tone={statusTone[idea.status]}>{t(`enums.ideaStatus.${idea.status}`)}</Badge>
        </div>
        {idea.hook && (
          <p className="rounded-md border-s-4 border-primary/50 bg-primary/5 px-3 py-2 text-sm italic leading-7">
            «{idea.hook}»
          </p>
        )}
        {idea.angle && (
          <p className="text-sm leading-7">
            <span className="font-medium text-muted-foreground">{t('ideas.angle')}: </span>
            {idea.angle}
          </p>
        )}
        {idea.outline.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              {t('ideas.outline')}
            </summary>
            <ol className="mt-2 list-decimal space-y-1 ps-5 leading-7">
              {idea.outline.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ol>
            {idea.rationale && (
              <p className="mt-2 text-xs leading-6 text-muted-foreground">💡 {idea.rationale}</p>
            )}
          </details>
        )}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-1 border-t px-3 py-2">
          <Button
            size="sm"
            icon={<PenLine />}
            onClick={() => onWrite(idea)}
            disabled={idea.status === 'REJECTED'}
          >
            {t('ideas.write')}
          </Button>
          {idea.status === 'REJECTED' ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw />}
              onClick={() => setStatus('PROPOSED')}
            >
              {t('ideas.restore')}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Star className={idea.status === 'SHORTLISTED' ? 'fill-current' : ''} />}
                onClick={() =>
                  setStatus(idea.status === 'SHORTLISTED' ? 'PROPOSED' : 'SHORTLISTED')
                }
              >
                {t('ideas.shortlist')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<ThumbsDown />}
                onClick={() => setStatus('REJECTED')}
              >
                {t('ideas.reject')}
              </Button>
            </>
          )}
          <div className="flex-1" />
          <ConfirmationDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                <Trash2 className="text-muted-foreground" />
              </Button>
            }
            onConfirm={() => remove.mutateAsync(idea.id)}
          />
        </div>
      )}
    </Card>
  );
}

export function IdeasPanel({ topicId, hasProfile }: { topicId: string; hasProfile: boolean }) {
  const t = useT();
  const editable = useCanEditTopic(topicId);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<IdeaStatus | ''>('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [writeIdea, setWriteIdea] = useState<Idea | null>(null);
  const ideateDialog = useDisclosure();
  const writeDialog = useDisclosure();
  const { data, isLoading } = useIdeas(topicId, { page, status, pageSize: 12 });
  const { isRunning } = useTrackJob(jobId, {
    invalidate: [ideaKeys.all, ['topics']],
    onDone: () => setJobId(null),
  });

  const generateButton = editable && (
    <Button icon={<Sparkles />} onClick={ideateDialog.open} disabled={isRunning}>
      {t('ideas.generate')}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('ideas.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('ideas.subtitle')}</p>
        </div>
        {generateButton}
      </div>
      {!hasProfile && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">{t('ideas.noProfileWarning')}</p>
      )}
      {isRunning && <AiWorkingBanner hint={t('enums.jobType.IDEATE')} />}
      <Segmented
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        options={[
          { value: '', label: t('common.all') },
          { value: 'PROPOSED', label: t('enums.ideaStatus.PROPOSED') },
          { value: 'SHORTLISTED', label: t('enums.ideaStatus.SHORTLISTED') },
          { value: 'USED', label: t('enums.ideaStatus.USED') },
          { value: 'REJECTED', label: t('enums.ideaStatus.REJECTED') },
        ]}
      />
      {isLoading ? (
        <PageSpinner />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState icon={<Lightbulb />} title={t('ideas.empty')} action={generateButton} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onWrite={(i) => {
                  setWriteIdea(i);
                  writeDialog.open();
                }}
              />
            ))}
          </div>
          {data.totalPages > 1 && (
            <Card>
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                onPageChange={setPage}
              />
            </Card>
          )}
        </>
      )}
      <IdeateDialog
        topicId={topicId}
        open={ideateDialog.isOpen}
        onOpenChange={ideateDialog.setIsOpen}
        onQueued={setJobId}
      />
      {writeDialog.isOpen && (
        <GenerateContentDialog
          topicId={topicId}
          open
          onOpenChange={writeDialog.setIsOpen}
          idea={writeIdea}
        />
      )}
    </div>
  );
}
