import { useState } from 'react';
import {
  Check,
  CheckCheck,
  ChevronDown,
  History,
  Lock,
  LockOpen,
  Pencil,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import {
  BUSINESS_SECTION_MAX_CHARS,
  BUSINESS_SECTION_META,
  SECTION_LOCK_NOTE_MAX,
  SectionLock,
  type BusinessSection,
  type BusinessSectionKey,
  type BusinessSuggestion,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { MarkdownView } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/format';
import {
  useAcceptSuggestion,
  useDismissSuggestion,
  useRestoreRevision,
  useSectionRevisions,
  useUpdateSection,
} from '../api/businesses';
import { useReviewSection, useSetSectionLock } from '../api/profile-knowledge';

type Editing = { suggestionId: string | null; text: string } | null;

export function SectionCard({
  businessId,
  sectionKey,
  section,
  suggestions,
  editable,
  suggesting,
  onSuggest,
  open,
  onOpenChange,
}: {
  businessId: string;
  sectionKey: BusinessSectionKey;
  section?: BusinessSection;
  suggestions: BusinessSuggestion[];
  editable: boolean;
  /** An AI suggestion job for this section is running. */
  suggesting: boolean;
  onSuggest: (key: BusinessSectionKey) => void;
  /** The section body is expanded (collapsed by default; the parent owns it so the TOC can open it). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const save = useUpdateSection(businessId);
  const accept = useAcceptSuggestion();
  const dismiss = useDismissSuggestion();
  const review = useReviewSection(businessId);
  const { can } = useAuthorization();
  const [editing, setEditing] = useState<Editing>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const lock = section?.lock ?? 'NONE';
  // an admin-only section can be changed by admins alone (the server enforces it, docs/69)
  const canWrite = editable && (lock !== 'ADMIN_ONLY' || can('business:lock'));
  const content = section?.content.trim() ?? '';
  const title = t(`enums.businessSection.${sectionKey}`);
  const unreviewed = !!content && section?.source === 'AI' && !section.reviewedAt;
  const thin = !!content && content.length < BUSINESS_SECTION_META[sectionKey].minChars;

  const submitEdit = () => {
    if (!editing) return;
    const onError = (e: Error) => notify.error(t('common.error'), e.message);
    if (editing.suggestionId) {
      accept.mutate(
        { id: editing.suggestionId, data: { content: editing.text } },
        {
          onSuccess: () => {
            notify.success(t('businesses.suggestion.accepted'));
            setEditing(null);
          },
          onError,
        },
      );
    } else {
      save.mutate(
        { key: sectionKey, content: editing.text },
        {
          onSuccess: () => {
            notify.success(t('businesses.sectionSaved'));
            setEditing(null);
          },
          onError,
        },
      );
    }
  };

  return (
    <Card id={`section-${sectionKey}`}>
      <CardHeader
        className={open ? undefined : 'border-b-0'}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`section-body-${sectionKey}`}
              onClick={() => onOpenChange(!open)}
              className="inline-flex items-center gap-1.5 rounded-md text-start focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
            >
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
              {title}
            </button>
            {content && section && (
              <Badge tone={section.source === 'AI' ? 'primary' : 'neutral'}>
                {t(`enums.sectionSource.${section.source}`)}
              </Badge>
            )}
            {unreviewed && (
              <Badge tone="warning">
                <ShieldAlert />
                {t('businesses.review.unreviewed')}
              </Badge>
            )}
            {thin && <Badge tone="outline">{t('businesses.review.thin')}</Badge>}
            {lock !== 'NONE' && (
              <Badge tone="primary" title={section?.lockNote || undefined}>
                <Lock />
                {t(`businesses.lock.badge.${lock}`)}
              </Badge>
            )}
            {suggestions.length > 0 && (
              <Badge tone="warning">
                <Sparkles />
                {t('businesses.suggestion.label')}
              </Badge>
            )}
          </span>
        }
        description={t(`businesses.sectionHints.${sectionKey}`)}
        descriptionAsTip
        actions={
          <>
            {section && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('businesses.history')}
                title={t('businesses.history')}
                onClick={() => setHistoryOpen(true)}
              >
                <History />
              </Button>
            )}
            {can('business:lock') && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('businesses.lock.action')}
                title={t('businesses.lock.action')}
                onClick={() => setLockOpen(true)}
              >
                {lock === 'NONE' ? <LockOpen /> : <Lock />}
              </Button>
            )}
            {canWrite && !editing && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Pencil />}
                  onClick={() => {
                    setEditing({ suggestionId: null, text: section?.content ?? '' });
                    onOpenChange(true);
                  }}
                >
                  {content ? t('common.edit') : t('businesses.write')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Sparkles />}
                  isLoading={suggesting}
                  onClick={() => onSuggest(sectionKey)}
                >
                  {t('businesses.suggestAi')}
                </Button>
              </>
            )}
          </>
        }
      />
      <CardBody id={`section-body-${sectionKey}`} hidden={!open} className="space-y-4">
        {lock !== 'NONE' && (
          <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs leading-6">
            <Lock className="mt-1 size-3.5 shrink-0 text-primary" />
            <div>
              <p>{t(`businesses.lock.hint.${lock}`)}</p>
              {(section?.lockedBy || section?.lockNote) && (
                <p className="text-muted-foreground" data-bidi="">
                  {section?.lockedBy &&
                    t('businesses.lock.by', {
                      name: section.lockedBy.name,
                      date: formatDate(section.lockedAt),
                    })}
                  {section?.lockNote ? ` — ${section.lockNote}` : ''}
                </p>
              )}
            </div>
          </div>
        )}
        {editing ? (
          <div className="space-y-2">
            {editing.suggestionId && (
              <p className="text-xs text-muted-foreground">
                {t('businesses.suggestion.replaceNote')}
              </p>
            )}
            <Textarea
              rows={12}
              data-bidi=""
              autoFocus
              value={editing.text}
              maxLength={BUSINESS_SECTION_MAX_CHARS}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={submitEdit} isLoading={save.isPending || accept.isPending}>
                {editing.suggestionId ? t('businesses.suggestion.accept') : t('common.save')}
              </Button>
            </div>
          </div>
        ) : content ? (
          <>
            {unreviewed && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="text-xs leading-6">{t('businesses.review.hint')}</p>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<CheckCheck />}
                    isLoading={review.isPending}
                    onClick={() =>
                      review.mutate(sectionKey, {
                        onSuccess: () => notify.success(t('businesses.review.confirmed')),
                        onError: (e) => notify.error(t('common.error'), e.message),
                      })
                    }
                  >
                    {t('businesses.review.confirm')}
                  </Button>
                )}
              </div>
            )}
            <MarkdownView>{content}</MarkdownView>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {section?.updatedBy && (
                <span>
                  {t('businesses.updatedBy', {
                    name: section.updatedBy.name,
                    date: formatDate(section.updatedAt),
                  })}
                </span>
              )}
              {section?.reviewedAt && section.reviewedBy && section.source === 'AI' && (
                <span>
                  {t('businesses.review.reviewedBy', {
                    name: section.reviewedBy.name,
                    date: formatDate(section.reviewedAt),
                  })}
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('businesses.sectionEmpty')}</p>
        )}

        {suggesting && (
          <p className="flex items-center gap-2 text-sm text-primary">
            <Spinner size="sm" className="text-current" />
            {t('businesses.suggest.running')}
          </p>
        )}

        {!editing &&
          suggestions.map((s) => (
            <div
              key={s.id}
              className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Sparkles className="size-4" />
                {t('businesses.suggestion.label')}
                <span className="text-xs font-normal text-muted-foreground">
                  {formatDate(s.createdAt)}
                </span>
              </div>
              <MarkdownView>{s.content}</MarkdownView>
              {s.rationale && (
                <p className="text-xs leading-6 text-muted-foreground">{s.rationale}</p>
              )}
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="success"
                    icon={<Check />}
                    isLoading={accept.isPending && accept.variables?.id === s.id}
                    onClick={() =>
                      accept.mutate(
                        { id: s.id, data: {} },
                        {
                          onSuccess: () => notify.success(t('businesses.suggestion.accepted')),
                          onError: (e) => notify.error(t('common.error'), e.message),
                        },
                      )
                    }
                  >
                    {t('businesses.suggestion.accept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Pencil />}
                    onClick={() => setEditing({ suggestionId: s.id, text: s.content })}
                  >
                    {t('businesses.suggestion.editAccept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X />}
                    isLoading={dismiss.isPending && dismiss.variables === s.id}
                    onClick={() => dismiss.mutate(s.id)}
                  >
                    {t('businesses.suggestion.dismiss')}
                  </Button>
                </div>
              )}
            </div>
          ))}
      </CardBody>
      {lockOpen && (
        <LockDialog
          businessId={businessId}
          sectionKey={sectionKey}
          title={title}
          current={lock}
          note={section?.lockNote ?? ''}
          onOpenChange={setLockOpen}
        />
      )}
      {historyOpen && (
        <RevisionsDialog
          businessId={businessId}
          sectionKey={sectionKey}
          title={title}
          editable={canWrite}
          onOpenChange={setHistoryOpen}
        />
      )}
    </Card>
  );
}

/** The admin picks who may change the section (docs/69). */
function LockDialog({
  businessId,
  sectionKey,
  title,
  current,
  note: currentNote,
  onOpenChange,
}: {
  businessId: string;
  sectionKey: BusinessSectionKey;
  title: string;
  current: SectionLock;
  note: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const setLock = useSetSectionLock(businessId);
  const [level, setLevel] = useState<SectionLock>(current);
  const [note, setNote] = useState(currentNote);

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.lock.title', { section: title })}
      description={t('businesses.lock.intro')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            isLoading={setLock.isPending}
            onClick={() =>
              setLock.mutate(
                { key: sectionKey, lock: level, note },
                {
                  onSuccess: () => {
                    notify.success(
                      t(level === 'NONE' ? 'businesses.lock.unlocked' : 'businesses.lock.locked'),
                    );
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
        <fieldset className="space-y-2">
          <legend className="sr-only">{t('businesses.lock.action')}</legend>
          {SectionLock.map((value) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
                level === value && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="radio"
                name={`lock-${sectionKey}`}
                className="mt-1.5 accent-[var(--primary)]"
                checked={level === value}
                onChange={() => setLevel(value)}
              />
              <span>
                <span className="block font-semibold">{t(`businesses.lock.level.${value}`)}</span>
                <span className="block text-xs leading-6 text-muted-foreground">
                  {t(`businesses.lock.levelHint.${value}`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {level !== 'NONE' && (
          <Field label={t('businesses.lock.noteLabel')} hint={t('businesses.lock.noteHint')}>
            {(id) => (
              <Textarea
                id={id}
                data-bidi=""
                rows={2}
                maxLength={SECTION_LOCK_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function RevisionsDialog({
  businessId,
  sectionKey,
  title,
  editable,
  onOpenChange,
}: {
  businessId: string;
  sectionKey: BusinessSectionKey;
  title: string;
  editable: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const revisions = useSectionRevisions(businessId, sectionKey);
  const restore = useRestoreRevision();
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.revisions.title', { section: title })}
      className="max-w-3xl"
    >
      {revisions.isLoading ? (
        <Spinner />
      ) : !revisions.data?.length ? (
        <p className="text-sm text-muted-foreground">{t('businesses.revisions.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {revisions.data.map((r) => (
            <li key={r.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Badge tone={r.source === 'AI' ? 'primary' : 'neutral'}>
                    {t(`enums.sectionSource.${r.source}`)}
                  </Badge>
                  {r.createdBy?.name}
                  <span>{formatDate(r.createdAt)}</span>
                </span>
                {editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={restore.isPending && restore.variables === r.id}
                    onClick={() =>
                      restore.mutate(r.id, {
                        onSuccess: () => {
                          notify.success(t('businesses.revisions.restored'));
                          onOpenChange(false);
                        },
                        onError: (e) => notify.error(t('common.error'), e.message),
                      })
                    }
                  >
                    {t('businesses.revisions.restore')}
                  </Button>
                )}
              </div>
              <div className="max-h-60 overflow-y-auto">
                <MarkdownView>{r.content}</MarkdownView>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
