import { useNavigate } from 'react-router';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  Lock,
  MessageSquareText,
  Plus,
  SkipForward,
  Wand2,
} from 'lucide-react';
import type { WalkerStepKey } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT, type TranslationKey } from '@/i18n';
import { track } from '@/lib/tracker';
import { cn } from '@/utils/cn';
import { formatNumber, formatRelative } from '@/utils/format';
import { useSetSamplesSkipped, useTopics } from '@/features/topics/api/topics';
import { notify } from '@/stores/notifications';
import { useSmartActivity, useWalkerProgress } from '../api';
import { useSmart } from '../store';
import { stepHref, WALKER_STEPS } from '../walker-steps';

const stepKey = (step: WalkerStepKey, field: 'title' | 'subtitle' | 'todo') =>
  `smart.walker.steps.${step}.${field}` as TranslationKey;

export function WalkerTab() {
  const t = useT();
  const navigate = useNavigate();
  const { walkerTopicId, walkerStep, setWalkerStep, setWalkerTopic, setTab } = useSmart();
  const progress = useWalkerProgress(walkerTopicId, true);
  const topics = useTopics({ page: 1, pageSize: 50, status: 'ACTIVE' });
  const activity = useSmartActivity(true);
  const skip = useSetSamplesSkipped(walkerTopicId);

  const index = WALKER_STEPS.indexOf(walkerStep);
  const total = WALKER_STEPS.length;
  const data = progress.data;
  const current = data?.steps.find((s) => s.key === walkerStep);

  const goTo = (step: WalkerStepKey, navigateToo = true) => {
    setWalkerStep(step);
    track('walker.step', { target: step, meta: { topicId: walkerTopicId } });
    if (navigateToo) {
      const href = stepHref(step, walkerTopicId, data?.refs);
      track('walker.navigate', { target: href });
      navigate(href);
    }
  };

  const setSkipped = (value: boolean) =>
    skip.mutate(value, {
      onSuccess: () => notify.info(t(value ? 'samples.skippedToast' : 'samples.resumedToast')),
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  const statusBadge = current?.skipped ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      <SkipForward className="size-3" /> {t('smart.walker.skipped')}
    </span>
  ) : current?.done ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">
      <CheckCircle2 className="size-3" /> {t('smart.walker.done')}
    </span>
  ) : current?.blocked ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Lock className="size-3" /> {t('smart.walker.blocked')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium">
      <Circle className="size-3" /> {t('smart.walker.todo')}
    </span>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* project picker */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t('smart.walker.project')}</p>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={walkerTopicId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setWalkerTopic(id);
                  if (id) navigate(paths.app.topic.getHref(id));
                }}
                placeholder={t('smart.walker.selectProject')}
                options={(topics.data?.items ?? []).map((tp) => ({
                  value: tp.id,
                  label: tp.title,
                }))}
              />
            </div>
            <Button
              size="icon"
              variant="outline"
              title={t('smart.walker.newProject')}
              aria-label={t('smart.walker.newProject')}
              onClick={() => {
                setWalkerTopic(null);
                navigate(`${paths.app.topics.getHref()}?new=1`);
              }}
            >
              <Plus />
            </Button>
          </div>
        </div>

        {/* step progress rail */}
        <div className="flex items-center gap-1" aria-hidden>
          {WALKER_STEPS.map((key, i) => {
            const s = data?.steps.find((x) => x.key === key);
            return (
              <button
                key={key}
                onClick={() => goTo(key)}
                title={t(stepKey(key, 'title'))}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-all',
                  s?.skipped ? 'bg-success/40' : s?.done ? 'bg-success' : 'bg-muted',
                  i === index && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
                )}
              />
            );
          })}
        </div>

        {/* current step */}
        {progress.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : data?.completed && walkerTopicId ? (
          <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-center">
            <p className="font-semibold">{t('smart.walker.completed')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('smart.walker.completedHint')}</p>
          </div>
        ) : null}

        <div className="rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-primary">
              {t('smart.walker.step', {
                current: formatNumber(index + 1),
                total: formatNumber(total),
              })}
            </span>
            {statusBadge}
          </div>
          <h3 className="text-base font-bold leading-7">{t(stepKey(walkerStep, 'title'))}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t(stepKey(walkerStep, 'subtitle'))}
          </p>
          {current?.target !== undefined && (
            <p className="mt-2 text-xs font-medium">
              {t('smart.walker.progress', {
                current: formatNumber(current.current ?? 0),
                target: formatNumber(current.target),
              })}
            </p>
          )}
          <div className="mt-3 rounded-lg bg-muted/50 p-3">
            <p className="mb-1.5 text-xs font-semibold">{t('smart.walker.whatToDo')}</p>
            <ol className="list-decimal space-y-1 ps-4 text-xs leading-6">
              {t(stepKey(walkerStep, 'todo'))
                .split('\n')
                .map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
            </ol>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={<ExternalLink />} onClick={() => goTo(walkerStep)}>
              {t('smart.walker.goToPage')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<MessageSquareText />}
              onClick={() => {
                sessionStorage.setItem(
                  'smart-chat-prefill',
                  t('smart.walker.askPrefill', { step: t(stepKey(walkerStep, 'title')) }),
                );
                setTab('chat');
              }}
            >
              {t('smart.walker.askAboutStep')}
            </Button>
          </div>
          {current?.skippable && walkerTopicId && (current.skipped || !current.done) && (
            <div className="mt-3 rounded-lg border border-dashed p-3">
              {!current.skipped && (
                <p className="mb-2 text-xs leading-6 text-muted-foreground">
                  {t('smart.walker.skipHint')}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                icon={<SkipForward />}
                isLoading={skip.isPending}
                onClick={() => setSkipped(!current.skipped)}
              >
                {current.skipped ? t('smart.walker.resume') : t('smart.walker.skip')}
              </Button>
            </div>
          )}
          {data?.nextStep && data.nextStep !== walkerStep && walkerTopicId && (
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 py-2 text-xs font-medium text-primary hover:bg-primary/5"
              onClick={() => goTo(data.nextStep!)}
            >
              <Wand2 className="size-3.5" />
              {t('smart.walker.goToSuggested')}: {t(stepKey(data.nextStep, 'title'))}
            </button>
          )}
        </div>

        {/* recent activity from the audit + interaction logs */}
        <details className="rounded-xl border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">
            {t('smart.walker.recentActivity')}
          </summary>
          {activity.data?.length ? (
            <ul className="mt-2 space-y-1.5">
              {activity.data.map((a) => (
                <li key={`${a.kind}-${a.id}`} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate" dir="ltr">
                    {a.label}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted-foreground">{t('smart.walker.noActivity')}</p>
          )}
        </details>
      </div>

      {/* prev / next */}
      <footer className="flex items-center justify-between gap-2 border-t p-3">
        <Button
          size="sm"
          variant="outline"
          disabled={index <= 0}
          onClick={() => goTo(WALKER_STEPS[index - 1])}
        >
          <ChevronRight className="ltr:hidden" />
          <ChevronLeft className="rtl:hidden" />
          {t('smart.walker.prev')}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatNumber(index + 1)} / {formatNumber(total)}
        </span>
        <Button
          size="sm"
          disabled={index >= total - 1 || (!walkerTopicId && index === 0)}
          onClick={() => goTo(WALKER_STEPS[index + 1])}
        >
          {t('smart.walker.next')}
          <ChevronLeft className="ltr:hidden" />
          <ChevronRight className="rtl:hidden" />
        </Button>
      </footer>
    </div>
  );
}
