import { useState } from 'react';
import { CalendarCheck, CalendarX, ExternalLink, Send, Undo2 } from 'lucide-react';
import type { Content } from '@contenter/shared';
import { canPublish, canSchedule, calendarStateOf } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Field, Input } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { fromLocalInput, toLocalInput } from '@/utils/calendar';
import { formatDate } from '@/utils/format';
import { usePublish, useSchedule, useUnpublish } from '../api/calendar';

export type Schedulable = Pick<
  Content,
  'id' | 'status' | 'scheduledAt' | 'publishedAt' | 'publishedUrl'
>;

/** The date-time in the language's own calendar, so a Persian reader sees the Jalali date. */
function InputDate({ value }: { value: string }) {
  const iso = fromLocalInput(value);
  return iso ? <span>{formatDate(iso)}</span> : null;
}

/** Plan the publication, and record it once the content went live elsewhere. */
function PlanForm({ content }: { content: Schedulable }) {
  const t = useT();
  const schedule = useSchedule(content.id);
  const publish = usePublish(content.id);
  const [when, setWhen] = useState(toLocalInput(content.scheduledAt));
  const [url, setUrl] = useState('');
  const [liveAt, setLiveAt] = useState('');
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const planned = fromLocalInput(when);
  const state = calendarStateOf({ scheduledAt: content.scheduledAt, publishedAt: null });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Field
          label={t('calendar.plannedFor')}
          hint={
            when ? (
              <>
                <InputDate value={when} />
                {state === 'OVERDUE' && (
                  <span className="ms-2 text-destructive">{t('calendar.overdueHint')}</span>
                )}
              </>
            ) : (
              t('calendar.notPlanned')
            )
          }
        >
          {(id) => (
            <Input
              id={id}
              type="datetime-local"
              dir="ltr"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<CalendarCheck />}
            disabled={!planned || planned === content.scheduledAt}
            isLoading={schedule.isPending}
            onClick={() =>
              schedule.mutate(
                { scheduledAt: planned },
                { onSuccess: () => notify.success(t('calendar.planned')), onError },
              )
            }
          >
            {t('calendar.savePlan')}
          </Button>
          {content.scheduledAt && (
            <Button
              size="sm"
              variant="ghost"
              icon={<CalendarX />}
              isLoading={schedule.isPending}
              onClick={() =>
                schedule.mutate(
                  { scheduledAt: null },
                  {
                    onSuccess: () => {
                      setWhen('');
                      notify.success(t('calendar.unplanned'));
                    },
                    onError,
                  },
                )
              }
            >
              {t('calendar.removePlan')}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">{t('calendar.markPublished')}</p>
        <p className="text-xs leading-6 text-muted-foreground">{t('calendar.markPublishedHint')}</p>
        <Field label={t('calendar.publishedUrl')} optional={t('common.optional')}>
          {(id) => (
            <Input
              id={id}
              type="url"
              dir="ltr"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('calendar.publishedAt')}
          optional={t('common.optional')}
          hint={t('calendar.publishedAtHint')}
        >
          {(id) => (
            <Input
              id={id}
              type="datetime-local"
              dir="ltr"
              value={liveAt}
              onChange={(e) => setLiveAt(e.target.value)}
            />
          )}
        </Field>
        <Button
          size="sm"
          variant="success"
          icon={<Send />}
          isLoading={publish.isPending}
          onClick={() =>
            publish.mutate(
              { publishedAt: fromLocalInput(liveAt) ?? undefined, url: url.trim() || undefined },
              { onSuccess: () => notify.success(t('calendar.published')), onError },
            )
          }
        >
          {t('calendar.markPublishedAction')}
        </Button>
      </div>
    </div>
  );
}

function PublishedView({ content }: { content: Schedulable }) {
  const t = useT();
  const unpublish = useUnpublish(content.id);
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone="success">{t('calendar.state.PUBLISHED')}</Badge>
        <span>{formatDate(content.publishedAt)}</span>
      </p>
      {content.publishedUrl && (
        <a
          href={content.publishedUrl}
          target="_blank"
          rel="noreferrer noopener"
          dir="ltr"
          className="flex items-center gap-1.5 break-all text-primary hover:underline"
        >
          <ExternalLink className="size-4 shrink-0" />
          {content.publishedUrl}
        </a>
      )}
      <p className="text-xs leading-6 text-muted-foreground">{t('calendar.frozenHint')}</p>
      <ConfirmationDialog
        trigger={
          <Button size="sm" variant="outline" icon={<Undo2 />}>
            {t('calendar.unpublish')}
          </Button>
        }
        title={t('calendar.unpublishTitle')}
        body={t('calendar.unpublishBody')}
        confirmLabel={t('calendar.unpublish')}
        tone="default"
        onConfirm={() =>
          unpublish.mutateAsync().then(
            () => notify.success(t('calendar.unpublished')),
            (e: Error) => notify.error(t('common.error'), e.message),
          )
        }
      />
    </div>
  );
}

/** Everything about when a content goes out; used on the content page and in the calendar. */
export function SchedulePanel({ content, editable }: { content: Schedulable; editable: boolean }) {
  const t = useT();
  if (content.publishedAt) {
    return editable ? (
      <PublishedView content={content} />
    ) : (
      <p className="text-sm">
        <Badge tone="success">{t('calendar.state.PUBLISHED')}</Badge>{' '}
        {formatDate(content.publishedAt)}
      </p>
    );
  }
  if (!canSchedule(content) || !canPublish(content)) {
    return <p className="text-sm leading-6 text-muted-foreground">{t('calendar.approvedOnly')}</p>;
  }
  if (!editable) {
    return (
      <p className="text-sm">
        {content.scheduledAt ? formatDate(content.scheduledAt) : t('calendar.notPlanned')}
      </p>
    );
  }
  // re-keyed by the stored plan so the form follows changes made elsewhere (e.g. a drag)
  return <PlanForm key={content.scheduledAt ?? 'none'} content={content} />;
}
