import { useState } from 'react';
import { ChevronDown, MessageSquareText, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { BUSINESS_NOTE_MAX_CHARS, ResearchScope, type NoteApplyMode } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Switch, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/format';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import {
  businessKeys,
  useCreateNote,
  useDeleteNote,
  useNotes,
  useReferences,
  useUpdateNote,
} from '../api/businesses';
import { ScopePicker, scopeIsUsable, type ScopeValue } from './scope-picker';

const HISTORY_PREVIEW = 3;

/**
 * "Note for AI": the admin explains or corrects something and AI brings the whole profile in
 * line with it (BUSINESS_REVISE). Shows the running job and the history of notes with what
 * each one changed.
 */
export function NotesCard({
  businessId,
  hasWebsite,
  disabled,
}: {
  businessId: string;
  hasWebsite: boolean;
  /** A build is running — a revision would race with it. */
  disabled?: boolean;
}) {
  const t = useT();
  const { can } = useAuthorization();
  const editable = can('content:write');
  const notes = useNotes(businessId);
  const refs = useReferences(businessId);
  const create = useCreateNote(businessId);
  const update = useUpdateNote(businessId);
  const remove = useDeleteNote(businessId);

  const [text, setText] = useState('');
  const [apply, setApply] = useState<NoteApplyMode>('DIRECT');
  const [scope, setScope] = useState<ScopeValue>({ scope: 'NONE', referenceIds: null });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const pending = notes.data?.find((n) => n.status === 'PENDING');
  const tracker = useTrackJob(pending?.jobId, {
    invalidate: [
      businessKeys.one(businessId),
      businessKeys.suggestions(businessId),
      businessKeys.notes(businessId),
    ],
  });
  const running = !!pending && tracker.isRunning;
  const usable = scopeIsUsable(scope, refs.data, hasWebsite);
  const history = showAll ? notes.data : notes.data?.slice(0, HISTORY_PREVIEW);

  const submit = () =>
    create.mutate(
      {
        text: text.trim(),
        apply,
        scope: scope.scope,
        referenceIds: scope.referenceIds ?? undefined,
      },
      {
        onSuccess: () => {
          notify.info(t('businesses.notes.queued'));
          setText('');
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-primary" />
            {t('businesses.notes.title')}
          </span>
        }
        description={t('businesses.notes.hint')}
      />
      <CardBody className="space-y-4">
        {running && (
          <AiWorkingBanner
            title={t('businesses.notes.running')}
            hint={t('businesses.notes.runningHint')}
          />
        )}
        {editable && (
          <div className="space-y-3">
            <Textarea
              rows={4}
              dir="auto"
              value={text}
              maxLength={BUSINESS_NOTE_MAX_CHARS}
              placeholder={t('businesses.notes.placeholder')}
              aria-label={t('businesses.notes.title')}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={optionsOpen}
              onClick={() => setOptionsOpen((v) => !v)}
            >
              <ChevronDown className={cn('size-3.5 transition', optionsOpen && 'rotate-180')} />
              {t('businesses.notes.options')}
              <span className="text-foreground">
                · {t(`businesses.scope.${scope.scope}`)} · {t(`businesses.notes.apply.${apply}`)}
              </span>
            </button>
            {optionsOpen && (
              <div className="space-y-4 rounded-lg border p-4">
                <ScopePicker
                  businessId={businessId}
                  scopes={ResearchScope}
                  value={scope}
                  onChange={setScope}
                  hasWebsite={hasWebsite}
                />
                <div className="space-y-1">
                  <Switch
                    checked={apply === 'SUGGEST'}
                    onCheckedChange={(v) => setApply(v ? 'SUGGEST' : 'DIRECT')}
                    label={t('businesses.notes.asSuggestions')}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t(`businesses.notes.applyHint.${apply}`)}
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {disabled ? t('businesses.notes.waitBuild') : ''}
              </span>
              <Button
                icon={<Sparkles />}
                isLoading={create.isPending}
                disabled={text.trim().length < 3 || running || disabled || !usable}
                onClick={submit}
              >
                {t('businesses.notes.submit')}
              </Button>
            </div>
          </div>
        )}

        {!!history?.length && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              {t('businesses.notes.history')}
            </h3>
            <ul className="divide-y rounded-lg border">
              {history.map((n) => (
                <li key={n.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-start gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap break-words" dir="auto">
                      {n.text}
                    </p>
                    <Badge
                      tone={
                        n.status === 'APPLIED'
                          ? 'success'
                          : n.status === 'FAILED'
                            ? 'danger'
                            : 'primary'
                      }
                    >
                      {t(`enums.noteStatus.${n.status}`)}
                    </Badge>
                  </div>
                  {n.status === 'APPLIED' && (
                    <div className="space-y-1.5 rounded-md bg-muted px-3 py-2 text-xs leading-6">
                      {n.summary && <p dir="auto">{n.summary}</p>}
                      <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                        {n.changedKeys.length
                          ? t(`businesses.notes.changed.${n.apply}`)
                          : t('businesses.notes.noChange')}
                        {n.changedKeys.map((k) => (
                          <Badge key={k} tone="outline">
                            {t(`enums.businessSection.${k}`)}
                          </Badge>
                        ))}
                      </p>
                    </div>
                  )}
                  {n.status === 'FAILED' && n.error && (
                    <p className="flex items-start gap-1.5 text-xs leading-5 text-destructive">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span dir="auto">{n.error}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {formatDate(n.createdAt)}
                      {n.createdBy && ` · ${n.createdBy.name}`}
                    </span>
                    {editable && n.status !== 'PENDING' && (
                      <span className="flex items-center gap-2">
                        {n.status === 'APPLIED' && (
                          <span title={t('businesses.notes.keepHint')}>
                            <Switch
                              checked={n.isActive}
                              disabled={update.isPending}
                              onCheckedChange={(isActive) => update.mutate({ id: n.id, isActive })}
                              label={<span className="text-xs">{t('businesses.notes.keep')}</span>}
                            />
                          </span>
                        )}
                        <ConfirmationDialog
                          body={t('businesses.notes.deleteBody')}
                          isLoading={remove.isPending}
                          trigger={
                            <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                              <Trash2 />
                            </Button>
                          }
                          onConfirm={() =>
                            remove
                              .mutateAsync(n.id)
                              .catch((e: Error) => notify.error(t('common.error'), e.message))
                          }
                        />
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {(notes.data?.length ?? 0) > HISTORY_PREVIEW && (
              <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll
                  ? t('businesses.notes.showLess')
                  : t('businesses.notes.showAll', { count: notes.data!.length })}
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
