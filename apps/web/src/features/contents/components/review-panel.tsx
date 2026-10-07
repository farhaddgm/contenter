import { useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  MessageSquareWarning,
  RotateCcw,
  Send,
  ShieldCheck,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  REVIEW_ACTIONS_NEEDING_NOTE,
  type Content,
  type ContentReview,
  type ReviewAction,
} from '@contenter/shared';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { useT, type TranslationKey } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatRelative } from '@/utils/format';
import { useReviewAction } from '../api/contents';

const MIN_NOTE = 3;

interface ActionView {
  icon: LucideIcon;
  variant: ButtonProps['variant'];
}

const ACTION_VIEW: Record<ReviewAction, ActionView> = {
  submit: { icon: Send, variant: 'secondary' },
  approve: { icon: CheckCircle2, variant: 'success' },
  finalize: { icon: ShieldCheck, variant: 'outline' },
  request_changes: { icon: MessageSquareWarning, variant: 'outline' },
  reject: { icon: XCircle, variant: 'outline' },
  withdraw: { icon: Undo2, variant: 'ghost' },
  reopen: { icon: RotateCcw, variant: 'outline' },
};

/** Which label an action wears depends on where the content waits. */
function actionLabel(action: ReviewAction, content: Content): TranslationKey {
  if (action === 'approve') {
    return content.reviewStage === 'EDITORIAL' && content.review?.requireFinalApproval
      ? 'review.actions.approveEditorial'
      : 'review.actions.approveFinal';
  }
  return `review.actions.${action}`;
}

/** Mounted only while open, so the note starts empty without a reset effect. */
function NoteDialog({
  action,
  label,
  isLoading,
  onSubmit,
  onClose,
}: {
  action: ReviewAction;
  label: string;
  isLoading: boolean;
  onSubmit: (note: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={label}
      description={t(`review.noteHint.${action as 'request_changes' | 'reject'}`)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={action === 'reject' ? 'destructive' : 'default'}
            isLoading={isLoading}
            disabled={note.trim().length < MIN_NOTE}
            onClick={() => onSubmit(note.trim())}
          >
            {label}
          </Button>
        </>
      }
    >
      <Field label={t('review.note')}>
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            dir="auto"
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

/**
 * The buttons of the workflow steps the server says the caller may take. The server checks the
 * same rules (`applyReviewAction` in packages/shared), so this only decides what to show.
 */
export function ReviewActionButtons({ content }: { content: Content }) {
  const t = useT();
  const review = useReviewAction(content.id);
  const [asking, setAsking] = useState<ReviewAction | null>(null);
  const actions = content.review?.actions ?? [];

  const run = (action: ReviewAction, note?: string) =>
    review.mutate(
      { action, note },
      {
        onSuccess: () => {
          notify.success(t('review.done'));
          setAsking(null);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <>
      {actions.map((action) => {
        const { icon: Icon, variant } = ACTION_VIEW[action];
        return (
          <Button
            key={action}
            variant={variant}
            icon={<Icon />}
            disabled={review.isPending}
            onClick={() =>
              REVIEW_ACTIONS_NEEDING_NOTE.includes(action) ? setAsking(action) : run(action)
            }
          >
            {t(actionLabel(action, content))}
          </Button>
        );
      })}
      {asking && (
        <NoteDialog
          action={asking}
          label={t(actionLabel(asking, content))}
          isLoading={review.isPending}
          onSubmit={(note) => run(asking, note)}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}

const DECISION_ICON: Record<ContentReview['decision'], LucideIcon> = {
  SUBMITTED: Send,
  APPROVED: CheckCircle2,
  CHANGES_REQUESTED: MessageSquareWarning,
  REJECTED: XCircle,
  WITHDRAWN: Undo2,
  REOPENED: RotateCcw,
  RESET: CircleDot,
};

const DECISION_TONE: Record<ContentReview['decision'], string> = {
  SUBMITTED: 'text-primary',
  APPROVED: 'text-success',
  CHANGES_REQUESTED: 'text-warning',
  REJECTED: 'text-destructive',
  WITHDRAWN: 'text-muted-foreground',
  REOPENED: 'text-muted-foreground',
  RESET: 'text-muted-foreground',
};

/** Who did what to this content, newest first; the note is the reason they gave. */
export function ReviewTimelineCard({ content }: { content: Content }) {
  const t = useT();
  const reviews = content.reviews ?? [];
  if (!reviews.length && content.status !== 'IN_REVIEW') return null;
  return (
    <Card>
      <CardHeader
        title={t('review.title')}
        description={
          content.status === 'IN_REVIEW' && content.reviewStage
            ? t(`review.waitingFor.${content.reviewStage}`, {
                name: content.submittedBy?.name ?? '—',
              })
            : undefined
        }
      />
      {reviews.length > 0 && (
        <ol className="max-h-80 space-y-3 overflow-y-auto p-4">
          {reviews.map((r) => {
            const Icon = DECISION_ICON[r.decision];
            return (
              <li key={r.id} className="flex gap-2.5 text-sm">
                <Icon className={`mt-1 size-4 shrink-0 ${DECISION_TONE[r.decision]}`} />
                <div className="min-w-0 space-y-0.5">
                  <p className="leading-6">
                    <span className="font-medium">{r.actor?.name ?? t('review.unknownUser')}</span>{' '}
                    {t(`enums.reviewDecision.${r.decision}`)}
                    {r.stage && (
                      <span className="text-muted-foreground">
                        {' '}
                        · {t(`enums.reviewStage.${r.stage}`)}
                      </span>
                    )}
                  </p>
                  {r.note && (
                    <p
                      className="whitespace-pre-wrap rounded-md bg-muted px-2.5 py-1.5 text-xs leading-6"
                      dir="auto"
                    >
                      {r.note}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatRelative(r.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
