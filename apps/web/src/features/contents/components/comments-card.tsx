import { useState } from 'react';
import {
  CheckCircle2,
  CornerDownLeft,
  MessageSquare,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { ContentComment } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Textarea } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatNumber, formatRelative } from '@/utils/format';
import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from '../api/contents';

type Filter = 'all' | 'open' | 'resolved';

/** A box that sends text; remounted after each send, so it never needs a reset effect. */
function Composer({
  placeholder,
  submitLabel,
  initial = '',
  autoFocus,
  onSubmit,
  onCancel,
  isLoading,
}: {
  placeholder?: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  isLoading: boolean;
}) {
  const t = useT();
  const [body, setBody] = useState(initial);
  return (
    <div className="space-y-2">
      <Textarea
        rows={3}
        dir="auto"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button
          size="sm"
          isLoading={isLoading}
          disabled={!body.trim()}
          onClick={() => onSubmit(body.trim())}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function CommentBody({
  comment,
  contentId,
  currentVersionId,
  canWrite,
  isReply,
}: {
  comment: ContentComment;
  contentId: string;
  currentVersionId: string | null;
  canWrite: boolean;
  isReply?: boolean;
}) {
  const t = useT();
  const me = useUser();
  const update = useUpdateComment(contentId);
  const remove = useDeleteComment(contentId);
  const [editing, setEditing] = useState(false);
  const mine = me?.id === comment.author?.id;
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="text-sm font-medium text-foreground">
          {comment.author?.name ?? t('review.unknownUser')}
        </span>
        <span>{formatRelative(comment.createdAt)}</span>
        {!isReply && comment.version !== null && (
          <Badge tone={comment.versionId === currentVersionId ? 'primary' : 'neutral'}>
            {t('contents.version')} {formatNumber(comment.version)}
          </Badge>
        )}
      </div>
      {editing ? (
        <Composer
          initial={comment.body}
          autoFocus
          submitLabel={t('common.save')}
          isLoading={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(body) =>
            update.mutate(
              { id: comment.id, data: { body } },
              { onSuccess: () => setEditing(false), onError },
            )
          }
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-7" dir="auto">
          {comment.body}
        </p>
      )}
      {canWrite && !editing && (
        <div className="flex flex-wrap items-center gap-1">
          {!isReply && (
            <Button
              size="sm"
              variant="ghost"
              icon={comment.resolvedAt ? <RotateCcw /> : <CheckCircle2 />}
              isLoading={update.isPending}
              onClick={() =>
                update.mutate(
                  { id: comment.id, data: { resolved: !comment.resolvedAt } },
                  { onError },
                )
              }
            >
              {comment.resolvedAt ? t('comments.reopen') : t('comments.resolve')}
            </Button>
          )}
          {mine && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('common.edit')}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          )}
          {(mine || me?.role === 'ADMIN') && (
            <ConfirmationDialog
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              }
              body={isReply ? undefined : t('comments.deleteThreadBody')}
              onConfirm={() => remove.mutateAsync(comment.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Thread({
  thread,
  contentId,
  currentVersionId,
  canWrite,
}: {
  thread: ContentComment;
  contentId: string;
  currentVersionId: string | null;
  canWrite: boolean;
}) {
  const t = useT();
  const create = useCreateComment(contentId);
  const [replying, setReplying] = useState(false);
  const resolved = !!thread.resolvedAt;
  return (
    <li className={cn('space-y-3 rounded-lg border p-3', resolved && 'bg-muted/40')}>
      {resolved && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="size-3.5" />
          {t('comments.resolvedBy', { name: thread.resolvedBy?.name ?? '—' })}
        </p>
      )}
      <CommentBody
        comment={thread}
        contentId={contentId}
        currentVersionId={currentVersionId}
        canWrite={canWrite}
      />
      {!!thread.replies?.length && (
        <ul className="space-y-3 border-s-2 ps-3">
          {thread.replies.map((r) => (
            <li key={r.id}>
              <CommentBody
                comment={r}
                contentId={contentId}
                currentVersionId={currentVersionId}
                canWrite={canWrite}
                isReply
              />
            </li>
          ))}
        </ul>
      )}
      {canWrite &&
        (replying ? (
          <Composer
            autoFocus
            placeholder={t('comments.replyPlaceholder')}
            submitLabel={t('comments.reply')}
            isLoading={create.isPending}
            onCancel={() => setReplying(false)}
            onSubmit={(body) =>
              create.mutate(
                { body, parentId: thread.id },
                {
                  onSuccess: () => setReplying(false),
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={<CornerDownLeft />}
            onClick={() => setReplying(true)}
          >
            {t('comments.reply')}
          </Button>
        ))}
    </li>
  );
}

/** Comments on the draft; each thread remembers the version it was written about. */
export function CommentsCard({
  contentId,
  currentVersionId,
  viewedVersionId,
  canWrite,
}: {
  contentId: string;
  currentVersionId: string | null;
  /** The version on screen; new comments are attached to it. */
  viewedVersionId: string | null;
  canWrite: boolean;
}) {
  const t = useT();
  const { data: threads, isLoading } = useComments(contentId);
  const create = useCreateComment(contentId);
  const [filter, setFilter] = useState<Filter>('all');
  // bumped after each sent comment so the composer remounts empty
  const [round, setRound] = useState(0);

  const open = (threads ?? []).filter((c) => !c.resolvedAt).length;
  const shown = (threads ?? []).filter((c) =>
    filter === 'all' ? true : filter === 'open' ? !c.resolvedAt : !!c.resolvedAt,
  );

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MessageSquare className="size-4" />
            {t('comments.title')}
            {open > 0 && (
              <Badge tone="warning">{t('comments.openCount', { count: formatNumber(open) })}</Badge>
            )}
          </span>
        }
        actions={
          !!threads?.length && (
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('common.all') },
                { value: 'open', label: t('comments.open') },
                { value: 'resolved', label: t('comments.resolved') },
              ]}
            />
          )
        }
      />
      <div className="space-y-4 p-4">
        {canWrite && (
          <Composer
            key={round}
            placeholder={t('comments.placeholder')}
            submitLabel={t('comments.send')}
            isLoading={create.isPending}
            onSubmit={(body) =>
              create.mutate(
                { body, versionId: viewedVersionId ?? undefined },
                {
                  onSuccess: () => setRound((n) => n + 1),
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          />
        )}
        {isLoading ? (
          <PageSpinner />
        ) : !shown.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {threads?.length ? t('comments.noneInFilter') : t('comments.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((thread) => (
              <Thread
                key={thread.id}
                thread={thread}
                contentId={contentId}
                currentVersionId={currentVersionId}
                canWrite={canWrite}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
