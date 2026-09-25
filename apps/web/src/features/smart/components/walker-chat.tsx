import { useCallback } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import { Dropdown } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { formatRelative } from '@/utils/format';
import { useConversations, useDeleteConversation } from '../api';
import { useSmart } from '../store';
import { ChatView } from './chat-view';

/** The Walker assistant tab: one active conversation plus history. */
export function WalkerChat() {
  const t = useT();
  const { conversationId, setConversationId } = useSmart();
  const history = useConversations({ kind: 'WALKER' });
  const remove = useDeleteConversation();
  const current = history.data?.find((c) => c.id === conversationId);
  const onCreated = useCallback((id: string) => setConversationId(id || null), [setConversationId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="min-w-0 truncate text-xs font-medium" dir="auto">
          {current?.title || t('smart.chat.title')}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Dropdown.Root>
            <Dropdown.Trigger
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t('smart.chat.history')}
              aria-label={t('smart.chat.history')}
            >
              <History className="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Label>{t('smart.chat.history')}</Dropdown.Label>
              {(history.data ?? []).slice(0, 15).map((c) => (
                <Dropdown.Item key={c.id} onSelect={() => setConversationId(c.id)}>
                  <span className="flex w-60 flex-col">
                    <span className="truncate" dir="auto">
                      {c.title || '—'}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelative(c.updatedAt)}
                    </span>
                  </span>
                </Dropdown.Item>
              ))}
              {conversationId && (
                <>
                  <Dropdown.Separator />
                  <Dropdown.Item
                    destructive
                    icon={<Trash2 />}
                    onSelect={() =>
                      remove.mutate(conversationId, { onSuccess: () => setConversationId(null) })
                    }
                  >
                    {t('smart.chat.deleteChat')}
                  </Dropdown.Item>
                </>
              )}
            </Dropdown.Content>
          </Dropdown.Root>
          <button
            onClick={() => setConversationId(null)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t('smart.chat.newChat')}
            aria-label={t('smart.chat.newChat')}
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ChatView
          key={conversationId ?? 'new'}
          kind="WALKER"
          conversationId={conversationId}
          onConversationCreated={onCreated}
          emptyText={t('smart.chat.empty')}
        />
      </div>
    </div>
  );
}
