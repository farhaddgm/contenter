import { useState } from 'react';
import { Check, CheckCheck, History, Pencil, ShieldAlert, Sparkles, X } from 'lucide-react';
import {
  BUSINESS_SECTION_MAX_CHARS,
  BUSINESS_SECTION_META,
  type BusinessSection,
  type BusinessSectionKey,
  type BusinessSuggestion,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form-controls';
import { MarkdownView } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatDate } from '@/utils/format';
import {
  useAcceptSuggestion,
  useDismissSuggestion,
  useRestoreRevision,
  useSectionRevisions,
  useUpdateSection,
} from '../api/businesses';
import { useReviewSection } from '../api/profile-knowledge';

type Editing = { suggestionId: string | null; text: string } | null;

export function SectionCard({
  businessId,
  sectionKey,
  section,
  suggestions,
  editable,
  suggesting,
  onSuggest,
}: {
  businessId: string;
  sectionKey: BusinessSectionKey;
  section?: BusinessSection;
  suggestions: BusinessSuggestion[];
  editable: boolean;
  /** An AI suggestion job for this section is running. */
  suggesting: boolean;
  onSuggest: (key: BusinessSectionKey) => void;
}) {
  const t = useT();
  const save = useUpdateSection(businessId);
  const accept = useAcceptSuggestion();
  const dismiss = useDismissSuggestion();
  const review = useReviewSection(businessId);
  const [editing, setEditing] = useState<Editing>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
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
            {suggestions.length > 0 && (
              <Badge tone="warning">
                <Sparkles />
                {t('businesses.suggestion.label')}
              </Badge>
            )}
          </span>
        }
        description={t(`businesses.sectionHints.${sectionKey}`)}
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
            {editable && !editing && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Pencil />}
                  onClick={() => setEditing({ suggestionId: null, text: section?.content ?? '' })}
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
      <CardBody className="space-y-4">
        {editing ? (
          <div className="space-y-2">
            {editing.suggestionId && (
              <p className="text-xs text-muted-foreground">
                {t('businesses.suggestion.replaceNote')}
              </p>
            )}
            <Textarea
              rows={12}
              dir="auto"
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
                {editable && (
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
              {editable && (
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
      {historyOpen && (
        <RevisionsDialog
          businessId={businessId}
          sectionKey={sectionKey}
          title={title}
          editable={editable}
          onOpenChange={setHistoryOpen}
        />
      )}
    </Card>
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
