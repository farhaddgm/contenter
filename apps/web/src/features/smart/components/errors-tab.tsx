import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, ExternalLink, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageSpinner, Spinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber, formatRelative } from '@/utils/format';
import { useConversations, useSmartError, useSmartErrors } from '../api';
import { useSmart } from '../store';
import { ChatView } from './chat-view';
import { ErrorDetail, errorStatusTone } from './error-detail';

/** Chat about one error; reuses the latest conversation for that error if any. */
export function ErrorChat({ errorId }: { errorId: string }) {
  const t = useT();
  const existing = useConversations({ kind: 'ERROR', errorId });
  const [created, setCreated] = useState<string | null>(null);
  const onCreated = useCallback((id: string) => setCreated(id || null), []);
  if (existing.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const conversationId = created ?? existing.data?.[0]?.id ?? null;
  return (
    <ChatView
      key={conversationId ?? 'new'}
      kind="ERROR"
      errorId={errorId}
      conversationId={conversationId}
      onConversationCreated={onCreated}
      emptyText={t('smart.chat.errorEmpty')}
      quickPrompts={[
        {
          label: t('smart.chat.explainError'),
          prompt: t('smart.chat.explainErrorPrompt'),
          icon: <HelpCircle />,
        },
      ]}
    />
  );
}

export function ErrorsTab() {
  const t = useT();
  const navigate = useNavigate();
  const { selectedErrorId, openError } = useSmart();
  const [chatOpen, setChatOpen] = useState(false);
  const list = useSmartErrors({ page: 1, pageSize: 20 }, !selectedErrorId);
  const selected = useSmartError(selectedErrorId);

  if (selectedErrorId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <button
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (chatOpen) setChatOpen(false);
              else openError(null);
            }}
          >
            <ArrowRight className="size-3.5 ltr:rotate-180" />
            {chatOpen ? t('smart.errors.details') : t('smart.errors.back')}
          </button>
          <button
            className="flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() =>
              navigate(`${paths.app.admin.smartErrors.getHref()}?id=${selectedErrorId}`)
            }
          >
            <ExternalLink className="size-3" /> {t('smart.errors.openInPage')}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {selected.isLoading || !selected.data ? (
            <PageSpinner />
          ) : chatOpen ? (
            <ErrorChat errorId={selectedErrorId} />
          ) : (
            <div className="h-full overflow-y-auto p-4">
              <ErrorDetail error={selected.data} compact onTalk={() => setChatOpen(true)} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <p className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
        {t('smart.errors.recent')}
      </p>
      {list.isLoading ? (
        <PageSpinner />
      ) : !list.data?.items.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{t('smart.errors.none')}</p>
      ) : (
        <ul className="divide-y">
          {list.data.items.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => {
                  setChatOpen(false);
                  openError(e.id);
                }}
                className={cn(
                  'w-full px-4 py-3 text-start hover:bg-muted/50',
                  (e.status === 'RESOLVED' || e.status === 'IGNORED') && 'opacity-60',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={errorStatusTone[e.status]}>
                      {t(`smart.errors.statusLabels.${e.status}`)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {t(`smart.errors.sourceLabels.${e.source}`)}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    ×{formatNumber(e.count)} · {formatRelative(e.lastSeenAt)}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs leading-5" dir="auto">
                  {e.message}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
