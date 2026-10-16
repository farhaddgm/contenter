import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { FEEDBACK_NOTE_MAX_CHARS, FeedbackReason, type FeedbackTarget } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { notify } from '@/stores/notifications';
import { useMyFeedback, useRemoveFeedback, useSetFeedback } from '../api/feedback';

/**
 * 👍/👎 on something the AI wrote (docs/46-ai-feedback.md). One vote per person; a 👎 asks for a
 * reason (and an optional note) so the vote says what to fix. Clicking the same thumb again takes
 * the vote back.
 */
export function FeedbackButtons({
  targetType,
  targetId,
  topicId,
}: {
  targetType: FeedbackTarget;
  targetId: string;
  topicId: string;
}) {
  const t = useT();
  const mine = useMyFeedback(targetType, topicId);
  const set = useSetFeedback(targetType, topicId);
  const remove = useRemoveFeedback(targetType, topicId);
  const [asking, setAsking] = useState(false);

  const vote = mine.data?.find((f) => f.targetId === targetId) ?? null;
  const busy = set.isPending || remove.isPending;
  const fail = (e: Error) => notify.error(t('common.error'), e.message);

  const up = () => {
    setAsking(false);
    if (vote?.rating === 'UP') remove.mutate(targetId, { onError: fail });
    else set.mutate({ targetId, rating: 'UP' }, { onError: fail });
  };
  const down = () => {
    if (vote?.rating === 'DOWN' && !asking) remove.mutate(targetId, { onError: fail });
    else setAsking((a) => !a);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1" role="group" aria-label={t('feedback.label')}>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-pressed={vote?.rating === 'UP'}
          aria-label={t('feedback.up')}
          title={t('feedback.up')}
          disabled={busy}
          className={cn(vote?.rating === 'UP' && 'bg-success/15 text-success')}
          icon={<ThumbsUp />}
          onClick={up}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-pressed={vote?.rating === 'DOWN'}
          aria-label={t('feedback.down')}
          title={t('feedback.down')}
          disabled={busy}
          className={cn(vote?.rating === 'DOWN' && 'bg-destructive/15 text-destructive')}
          icon={<ThumbsDown />}
          onClick={down}
        />
      </div>
      {asking && (
        // mounted only while open, so the fields start from the saved vote without an effect
        <ReasonForm
          initialReason={vote?.rating === 'DOWN' ? vote.reason : null}
          initialNote={vote?.rating === 'DOWN' ? vote.note : ''}
          isLoading={set.isPending}
          onCancel={() => setAsking(false)}
          onSubmit={(reason, note) =>
            set.mutate(
              { targetId, rating: 'DOWN', reason, note },
              {
                onSuccess: () => {
                  setAsking(false);
                  notify.success(t('feedback.thanks'));
                },
                onError: fail,
              },
            )
          }
        />
      )}
    </div>
  );
}

function ReasonForm({
  initialReason,
  initialNote,
  isLoading,
  onCancel,
  onSubmit,
}: {
  initialReason: FeedbackReason | null;
  initialNote: string;
  isLoading: boolean;
  onCancel: () => void;
  onSubmit: (reason: FeedbackReason | null, note: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<FeedbackReason | ''>(initialReason ?? '');
  const [note, setNote] = useState(initialNote);
  return (
    <div className="w-64 space-y-2 rounded-xl border bg-card p-3 text-start shadow-pop">
      <Select
        aria-label={t('feedback.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value as FeedbackReason | '')}
        placeholder={t('feedback.reasonPlaceholder')}
        options={FeedbackReason.map((r) => ({ value: r, label: t(`feedback.reasons.${r}`) }))}
      />
      <Textarea
        aria-label={t('feedback.note')}
        placeholder={t('feedback.note')}
        rows={2}
        maxLength={FEEDBACK_NOTE_MAX_CHARS}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          isLoading={isLoading}
          onClick={() => onSubmit(reason || null, note.trim())}
        >
          {t('feedback.send')}
        </Button>
      </div>
    </div>
  );
}
