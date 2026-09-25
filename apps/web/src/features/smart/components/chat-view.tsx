import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookmarkCheck,
  BookmarkPlus,
  ClipboardList,
  Send,
  Sparkles,
  User,
} from 'lucide-react';
import type { ConversationKind, SmartConversation, SmartMessage } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form-controls';
import { MarkdownView } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { api } from '@/lib/api-client';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/format';
import { smartKeys, useConversation, useSaveIssue } from '../api';
import { useSmart } from '../store';

function MessageBubble({ message }: { message: SmartMessage }) {
  const t = useT();
  const save = useSaveIssue();
  const mine = message.role === 'USER';

  if (message.status === 'PENDING') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
        <Spinner size="sm" /> {t('smart.chat.thinking')}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {mine ? <User className="size-3" /> : <Sparkles className="size-3 text-primary" />}
        {mine ? t('smart.chat.you') : t('smart.chat.assistant')} ·{' '}
        {formatRelative(message.createdAt)}
      </span>
      <div
        className={cn(
          'max-w-[95%] rounded-xl px-3 py-2 text-sm',
          mine ? 'bg-primary text-primary-foreground' : 'border bg-card',
          message.status === 'FAILED' && 'border-destructive/40 bg-destructive/5',
        )}
      >
        {message.status === 'FAILED' ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive" dir="auto">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t('smart.chat.failed')}: {message.content}
          </p>
        ) : mine ? (
          <p className="whitespace-pre-wrap leading-7" dir="auto">
            {message.content}
          </p>
        ) : (
          <MarkdownView className="text-[13px] leading-7">{message.content}</MarkdownView>
        )}
      </div>
      {!mine &&
        message.status === 'DONE' &&
        (message.issueId ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-success">
            <BookmarkCheck className="size-3.5" /> {t('smart.chat.saved')}
          </span>
        ) : (
          <button
            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(message.id, {
                onSuccess: () => notify.success(t('smart.chat.savedToast')),
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            <BookmarkPlus className="size-3.5" /> {t('smart.chat.saveIssue')}
          </button>
        ))}
    </div>
  );
}

/**
 * Conversation with the Smart assistant. Creates the conversation lazily on the first
 * message. Each reply is produced by a queued SMART_CHAT AI job; the view polls until done.
 */
export function ChatView({
  kind,
  conversationId,
  onConversationCreated,
  errorId,
  emptyText,
  quickPrompts,
}: {
  kind: ConversationKind;
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  errorId?: string;
  emptyText: string;
  quickPrompts?: { label: string; prompt: string; icon?: React.ReactNode }[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const location = useLocation();
  const { walkerTopicId, walkerStep } = useSmart();
  const conversation = useConversation(conversationId);
  const [text, setText] = useState(() => {
    const prefill = sessionStorage.getItem('smart-chat-prefill');
    if (prefill && kind === 'WALKER') sessionStorage.removeItem('smart-chat-prefill');
    return kind === 'WALKER' ? (prefill ?? '') : '';
  });
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = conversation.data?.messages ?? [];
  const pending = messages.some((m) => m.status === 'PENDING');

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending]);

  // a conversation that no longer exists (deleted / other user) is dropped
  useEffect(() => {
    if (conversation.isError && conversationId) onConversationCreated('');
  }, [conversation.isError, conversationId, onConversationCreated]);

  const send = async (content: string) => {
    const body = content.trim();
    if (!body || sending || pending) return;
    setSending(true);
    try {
      let id = conversationId;
      if (!id) {
        const conv = await api.post<SmartConversation>('/smart/conversations', {
          kind,
          errorId,
          topicId: walkerTopicId ?? undefined,
          route: location.pathname,
        });
        id = conv.id;
        onConversationCreated(id);
        void qc.invalidateQueries({ queryKey: ['smart', 'conversations'] });
      }
      await api.post(`/smart/conversations/${id}/messages`, {
        content: body,
        route: location.pathname,
        topicId: walkerTopicId ?? undefined,
        walkerStep: kind === 'WALKER' ? walkerStep : undefined,
      });
      setText('');
      await qc.invalidateQueries({ queryKey: smartKeys.conversation(id) });
    } catch (e) {
      notify.error(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {conversation.isLoading && conversationId ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !messages.length ? (
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <p className="text-xs leading-6 text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={endRef} />
      </div>

      {(quickPrompts?.length || messages.length > 0) && (
        <div className="flex flex-wrap gap-1.5 border-t px-3 pt-2">
          {quickPrompts?.map((q) => (
            <button
              key={q.label}
              disabled={pending || sending}
              onClick={() => void send(q.prompt)}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50 [&_svg]:size-3"
            >
              {q.icon}
              {q.label}
            </button>
          ))}
          {messages.length > 0 && (
            <button
              disabled={pending || sending}
              onClick={() => void send(t('smart.chat.summarizePrompt'))}
              className="flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
            >
              <ClipboardList className="size-3" />
              {t('smart.chat.summarize')}
            </button>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        <Textarea
          rows={2}
          value={text}
          dir="auto"
          placeholder={t('smart.chat.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send(text);
            }
          }}
          className="min-h-0 resize-none text-sm"
        />
        <Button
          size="icon"
          aria-label={t('smart.chat.send')}
          isLoading={sending}
          disabled={!text.trim() || pending}
          onClick={() => void send(text)}
        >
          {!sending && <Send className="rtl:-scale-x-100" />}
        </Button>
      </div>
    </div>
  );
}
