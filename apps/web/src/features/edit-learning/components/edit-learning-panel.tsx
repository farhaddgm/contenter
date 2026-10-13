import { useState } from 'react';
import { Link } from 'react-router';
import { Lightbulb, Sparkles } from 'lucide-react';
import {
  PrincipleKind,
  type EditLearningOverview,
  type LearningSuggestion,
} from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { formatNumber } from '@/utils/format';
import { notify } from '@/stores/notifications';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { useCanEditTopic } from '@/features/topics/api/topics';
import {
  editLearningKeys,
  useAcceptSuggestion,
  useAnalyzeEdits,
  useDismissSuggestion,
  useEditLearning,
} from '../api/edit-learning';

const kindTone: Record<LearningSuggestion['kind'], BadgeTone> = {
  MUST: 'success',
  AVOID: 'danger',
  PREFER: 'primary',
};

const percent = (value: number) => `${formatNumber(Math.round(value * 100))}٪`;

/**
 * Learning from the edits editors make to AI drafts (docs/30-learn-from-edits.md): the numbers are
 * counted by code, the suggestions come from an AI job and each one needs the admin's decision.
 */
export function EditLearningPanel({ topicId }: { topicId: string }) {
  const t = useT();
  const canEdit = useCanEditTopic(topicId);
  const { data, isLoading } = useEditLearning(topicId);
  const analyze = useAnalyzeEdits(topicId);
  const [started, setStarted] = useState<string | null>(null);
  const jobId = started ?? data?.activeJob?.id ?? null;
  const tracker = useTrackJob(jobId, { invalidate: [editLearningKeys.overview(topicId)] });
  const running = !!jobId && tracker.isRunning;

  if (isLoading || !data) {
    return (
      <Card>
        <CardBody className="flex justify-center py-8">
          <Spinner />
        </CardBody>
      </Card>
    );
  }

  const start = () =>
    analyze.mutate(undefined, {
      onSuccess: (job) => setStarted(job.jobId),
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  return (
    <Card>
      <CardHeader
        title={t('editLearning.title')}
        description={t('editLearning.subtitle')}
        actions={
          canEdit && (
            <Button
              size="sm"
              onClick={start}
              disabled={!data.eligible || running || analyze.isPending}
              isLoading={analyze.isPending}
            >
              <Sparkles />
              {t('editLearning.analyze')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        <Stats data={data} />
        {!data.eligible && (
          <p className="text-sm text-muted-foreground">
            {t('editLearning.notEnough', { min: data.minPairs, edited: data.stats.edited })}
          </p>
        )}
        {running && (
          <AiWorkingBanner title={t('editLearning.working')} hint={t('editLearning.workingHint')} />
        )}
        {tracker.job?.status === 'FAILED' && !running && (
          <p className="text-sm text-destructive" dir="auto">
            {tracker.job.error ?? t('jobs.jobFailed')}
          </p>
        )}
        {data.pending.length > 0 ? (
          <ul className="space-y-3">
            {data.pending.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} topicId={topicId} editable={canEdit} />
            ))}
          </ul>
        ) : (
          data.lastRunAt &&
          !running && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lightbulb className="size-4" />
              {t('editLearning.nothingFound')}
            </p>
          )
        )}
        {data.decided.length > 0 && <Decided items={data.decided} />}
      </CardBody>
    </Card>
  );
}

function Stats({ data }: { data: EditLearningOverview }) {
  const t = useT();
  const { stats } = data;
  const cell = (label: string, value: string) => (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cell(t('editLearning.approved'), formatNumber(stats.approved))}
      {cell(t('editLearning.edited'), formatNumber(stats.edited))}
      {cell(
        t('editLearning.unedited'),
        stats.uneditedShare === null
          ? '—'
          : `${formatNumber(stats.unedited)} (${percent(stats.uneditedShare)})`,
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  topicId,
  editable,
}: {
  suggestion: LearningSuggestion;
  topicId: string;
  editable: boolean;
}) {
  const t = useT();
  const accept = useAcceptSuggestion(topicId);
  const dismiss = useDismissSuggestion(topicId);
  const [text, setText] = useState(suggestion.text);
  const [kind, setKind] = useState(suggestion.kind);
  const busy = accept.isPending || dismiss.isPending;

  const onAccept = () =>
    accept.mutate(
      {
        id: suggestion.id,
        data: {
          ...(text.trim() !== suggestion.text ? { text: text.trim() } : {}),
          ...(kind !== suggestion.kind ? { kind } : {}),
        },
      },
      {
        onSuccess: () => notify.success(t('editLearning.accepted')),
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={kindTone[suggestion.kind]}>
          {t(`enums.principleKind.${suggestion.kind}`)}
        </Badge>
        <Badge tone="outline">{t(`editLearning.categories.${suggestion.category}`)}</Badge>
        <span className="text-xs text-muted-foreground">
          {t('editLearning.seenIn', { count: suggestion.evidence.length })}
        </span>
      </div>
      {editable ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="sm:w-32">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as LearningSuggestion['kind'])}
              options={PrincipleKind.map((k) => ({
                value: k,
                label: t(`enums.principleKind.${k}`),
              }))}
            />
          </div>
          <Textarea
            rows={2}
            className="flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t('principles.text')}
          />
        </div>
      ) : (
        <p dir="auto">{suggestion.text}</p>
      )}
      {suggestion.rationale && (
        <p className="text-sm text-muted-foreground" dir="auto">
          {suggestion.rationale}
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {t('editLearning.evidence')}
        </summary>
        <ul className="mt-2 space-y-2">
          {suggestion.evidence.map((e) => (
            <li key={`${e.contentId}-${e.toVersion}`} className="rounded-md bg-muted/40 p-2">
              <Link
                className="text-primary hover:underline"
                to={paths.app.content.getHref(e.contentId)}
              >
                {e.contentTitle}
              </Link>
              <span className="ms-2 text-xs text-muted-foreground">
                {t('editLearning.changed', { percent: percent(e.changeRatio) })}
              </span>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-6" dir="auto">
                {e.excerpt}
              </p>
            </li>
          ))}
        </ul>
      </details>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={onAccept}
            disabled={busy || text.trim().length < 3}
            isLoading={accept.isPending}
          >
            {t('editLearning.accept')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dismiss.mutate(suggestion.id)}
            disabled={busy}
            isLoading={dismiss.isPending}
          >
            {t('editLearning.dismiss')}
          </Button>
        </div>
      )}
    </li>
  );
}

function Decided({ items }: { items: LearningSuggestion[] }) {
  const t = useT();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {t('editLearning.decided', { count: items.length })}
      </summary>
      <ul className="mt-2 space-y-1">
        {items.map((s) => (
          <li key={s.id} className="flex items-start gap-2">
            <Badge tone={s.status === 'ACCEPTED' ? 'success' : 'neutral'}>
              {t(`editLearning.status.${s.status}`)}
            </Badge>
            <span dir="auto">{s.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
