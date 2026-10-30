import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCw, Send, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import {
  BUSINESS_NOTE_MAX_CHARS,
  ResearchScope,
  BUSINESS_CHAT_MESSAGE_MAX_CHARS,
  latestUnderstood,
  touchedSections,
  type BusinessChat,
  type BusinessChatMessage,
  type ChatPoint,
  type NoteApplyMode,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Switch, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import {
  useApplyChat,
  useChatDigest,
  useDiscardChat,
  useProfileChat,
  useReferences,
  useRetryChatReply,
  useSendChatMessage,
} from '../api/businesses';
import { ScopePicker, scopeIsUsable, type ScopeValue } from './scope-picker';

const KIND_TONE = {
  FACT: 'primary',
  CORRECTION: 'warning',
  DECISION: 'success',
  PREFERENCE: 'neutral',
  OPEN: 'outline',
} as const;

function SectionBadges({ keys }: { keys: readonly string[] }) {
  const t = useT();
  return (
    <>
      {keys.map((k) => (
        <Badge key={k} tone="outline">
          {t(`enums.businessSection.${k}` as 'enums.businessSection.OVERVIEW')}
        </Badge>
      ))}
    </>
  );
}

function PointList({ points }: { points: ChatPoint[] }) {
  const t = useT();
  return (
    <ul className="space-y-2">
      {points.map((p, i) => (
        <li key={i} className="space-y-1 text-sm leading-6">
          <div className="flex flex-wrap items-start gap-2">
            <Badge tone={KIND_TONE[p.kind]}>{t(`businesses.notes.chat.kind.${p.kind}`)}</Badge>
            <span className="min-w-0 flex-1" data-bidi="">
              {p.point}
            </span>
          </div>
          {!!p.sections.length && (
            <div className="flex flex-wrap items-center gap-1.5 ps-1">
              <SectionBadges keys={p.sections} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Message({
  message,
  onRetry,
  retrying,
}: {
  message: BusinessChatMessage;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useT();
  const mine = message.role === 'USER';
  return (
    <div className={cn('flex', mine ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[92%] space-y-2 rounded-xl border px-4 py-3 text-sm leading-7 sm:max-w-[80%]',
          mine ? 'bg-accent text-accent-foreground' : 'bg-card',
        )}
      >
        <p className="text-xs font-medium text-muted-foreground">
          {mine ? t('businesses.notes.chat.you') : t('businesses.notes.chat.ai')}
        </p>
        {message.status === 'PENDING' && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-4 animate-pulse text-primary" />
            {t('businesses.notes.chat.thinking')}
          </p>
        )}
        {message.status === 'FAILED' && (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-destructive">
              <TriangleAlert className="mt-1 size-4 shrink-0" />
              <span data-bidi="">{message.error || t('businesses.notes.chat.failed')}</span>
            </p>
            <Button
              size="sm"
              variant="outline"
              icon={<RotateCw />}
              isLoading={retrying}
              onClick={onRetry}
            >
              {t('businesses.notes.chat.retry')}
            </Button>
          </div>
        )}
        {message.status === 'DONE' && (
          <p className="whitespace-pre-wrap break-words" data-bidi="">
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}

/** What AI understood so far, from the last finished reply: points, sections, clashes. */
function Understood({ chat }: { chat: BusinessChat }) {
  const t = useT();
  const points = latestUnderstood(chat.messages);
  const last = [...chat.messages].reverse().find((m) => m.role === 'ASSISTANT' && m.status === 'DONE');
  const conflicts = last?.conflicts ?? [];
  if (!points.length && !conflicts.length) return null;
  const touched = touchedSections(points);
  return (
    <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
      <div>
        <h3 className="text-sm font-semibold">{t('businesses.notes.chat.understoodTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('businesses.notes.chat.understoodHint')}</p>
      </div>
      {!!conflicts.length && (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-4 text-warning" />
            {t('businesses.notes.chat.conflictsTitle')}
          </p>
          <ul className="list-disc space-y-1 ps-5">
            {conflicts.map((c, i) => (
              <li key={i} data-bidi="">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      <PointList points={points} />
      {!!touched.length && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {t('businesses.notes.chat.willChange')}
          <SectionBadges keys={touched} />
        </p>
      )}
    </div>
  );
}

/**
 * The closing summary: editable text that becomes the note, how to apply it, and the button.
 * Mounted per digest (keyed by its text), so a new digest starts a fresh draft.
 */
function DigestPanel({
  businessId,
  chat,
  hasWebsite,
  disabled,
}: {
  businessId: string;
  chat: BusinessChat;
  hasWebsite: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const digest = chat.digest!;
  const refs = useReferences(businessId);
  const apply = useApplyChat(businessId);
  const [text, setText] = useState(digest.noteText);
  const [mode, setMode] = useState<NoteApplyMode>('DIRECT');
  const [standing, setStanding] = useState(true);
  const [scope, setScope] = useState<ScopeValue>({ scope: 'NONE', referenceIds: null });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const usable = scopeIsUsable(scope, refs.data, hasWebsite);
  const stale = chat.digestUpTo < chat.messages.filter((m) => m.status !== 'PENDING').length;

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 p-4">
      <div>
        <h3 className="text-sm font-semibold">{t('businesses.notes.chat.digestTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('businesses.notes.chat.digestHint')}</p>
      </div>
      {digest.summary && (
        <p className="text-sm leading-7" data-bidi="">
          {digest.summary}
        </p>
      )}
      {!!digest.points.length && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t('businesses.notes.chat.digestPoints')} ({digest.points.length})
          </summary>
          <div className="mt-2">
            <PointList points={digest.points} />
          </div>
        </details>
      )}
      <Textarea
        rows={9}
        data-bidi=""
        value={text}
        maxLength={BUSINESS_NOTE_MAX_CHARS}
        aria-label={t('businesses.notes.chat.digestTitle')}
        onChange={(e) => setText(e.target.value)}
      />
      {!!digest.openQuestions.length && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t('businesses.notes.chat.digestOpen')}</p>
          <ul className="list-disc space-y-0.5 ps-5">
            {digest.openQuestions.map((q, i) => (
              <li key={i} data-bidi="">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
      {stale && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {t('businesses.notes.chat.digestStale')}
        </p>
      )}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={optionsOpen}
        onClick={() => setOptionsOpen((v) => !v)}
      >
        <ChevronDown className={cn('size-3.5 transition', optionsOpen && 'rotate-180')} />
        {t('businesses.notes.options')}
        <span className="text-foreground">
          · {t(`businesses.scope.${scope.scope}`)} · {t(`businesses.notes.apply.${mode}`)}
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
          <Switch
            checked={mode === 'SUGGEST'}
            onCheckedChange={(v) => setMode(v ? 'SUGGEST' : 'DIRECT')}
            label={t('businesses.notes.asSuggestions')}
            hint={t(`businesses.notes.applyHint.${mode}`)}
          />
          <Switch
            checked={standing}
            onCheckedChange={setStanding}
            label={t('businesses.notes.keep')}
            hint={t('businesses.notes.keepHint')}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {disabled ? t('businesses.notes.waitBuild') : ''}
        </span>
        <Button
          icon={<Sparkles />}
          isLoading={apply.isPending}
          disabled={text.trim().length < 3 || stale || disabled || !usable}
          onClick={() =>
            apply.mutate(
              {
                chatId: chat.id,
                noteText: text.trim(),
                apply: mode,
                scope: scope.scope,
                referenceIds: scope.referenceIds ?? undefined,
                standing,
              },
              {
                onSuccess: () => notify.info(t('businesses.notes.chat.applied')),
                onError: (e) => notify.error(t('common.error'), e.message),
              },
            )
          }
        >
          {t('businesses.notes.chat.apply')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Conversation with AI about the profile (docs/75). Nothing changes while talking; the admin
 * ends it with a digest, edits that and applies it as a note (BUSINESS_REVISE).
 */
export function ProfileChat({
  businessId,
  hasWebsite,
  disabled,
}: {
  businessId: string;
  hasWebsite: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: chat } = useProfileChat(businessId);
  const send = useSendChatMessage(businessId);
  const retry = useRetryChatReply(businessId);
  const digest = useChatDigest(businessId);
  const discard = useDiscardChat(businessId);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const messages = chat?.messages ?? [];
  const waiting = messages.some((m) => m.status === 'PENDING');
  const writingDigest = chat?.digestStatus === 'PENDING';
  const talked = messages.some((m) => m.role === 'USER');

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages.length, waiting]);

  const submit = () => {
    const value = text.trim();
    if (!value || send.isPending || waiting || writingDigest) return;
    send.mutate(value, {
      onSuccess: () => setText(''),
      onError: (e) => notify.error(t('common.error'), e.message),
    });
  };
  const fail = (e: Error) => notify.error(t('common.error'), e.message);

  return (
    <div className="space-y-4">
      {!talked && (
        <div className="space-y-2 rounded-lg bg-muted/60 p-4 text-sm leading-7">
          <p>{t('businesses.notes.chat.intro')}</p>
          <p className="text-xs text-muted-foreground">{t('businesses.notes.chat.examplesTitle')}</p>
          <div className="flex flex-wrap gap-2">
            {(['one', 'two', 'three'] as const).map((k) => (
              <Button key={k} size="sm" variant="outline" onClick={() => setText(t(`businesses.notes.chat.examples.${k}`))}>
                {t(`businesses.notes.chat.examples.${k}`)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {!!messages.length && (
        <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border p-3">
          {messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              retrying={retry.isPending}
              onRetry={() => retry.mutate(chat!.id, { onError: fail })}
            />
          ))}
          <div ref={end} />
        </div>
      )}

      {chat && <Understood chat={chat} />}

      <div className="space-y-2">
        <Textarea
          rows={3}
          data-bidi=""
          value={text}
          maxLength={BUSINESS_CHAT_MESSAGE_MAX_CHARS}
          placeholder={t('businesses.notes.chat.placeholder')}
          aria-label={t('businesses.notes.chat.tabChat')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {chat && (
              <ConfirmationDialog
                body={t('businesses.notes.chat.restartBody')}
                isLoading={discard.isPending}
                trigger={
                  <Button size="sm" variant="ghost" icon={<Trash2 />}>
                    {t('businesses.notes.chat.restart')}
                  </Button>
                }
                onConfirm={() => discard.mutateAsync(chat.id).catch(fail)}
              />
            )}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {chat && talked && (
              <Button
                variant="outline"
                icon={<Sparkles />}
                isLoading={digest.isPending || writingDigest}
                disabled={waiting || disabled}
                onClick={() => digest.mutate(chat.id, { onError: fail })}
              >
                {chat.digest ? t('businesses.notes.chat.digestAgain') : t('businesses.notes.chat.finish')}
              </Button>
            )}
            <Button
              icon={<Send />}
              isLoading={send.isPending}
              disabled={!text.trim() || waiting || writingDigest}
              onClick={submit}
            >
              {t('businesses.notes.chat.send')}
            </Button>
          </span>
        </div>
      </div>

      {writingDigest && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4 animate-pulse text-primary" />
          {t('businesses.notes.chat.digestRunning')}
        </p>
      )}
      {chat?.digestStatus === 'FAILED' && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <TriangleAlert className="mt-1 size-4 shrink-0" />
          <span data-bidi="">{chat.digestError || t('businesses.notes.chat.digestFailed')}</span>
        </p>
      )}
      {chat?.digest && chat.digestStatus === 'DONE' && (
        <DigestPanel
          key={`${chat.digestUpTo}:${chat.digest.noteText}`}
          businessId={businessId}
          chat={chat}
          hasWebsite={hasWebsite}
          disabled={disabled}
        />
      )}
    </div>
  );
}
