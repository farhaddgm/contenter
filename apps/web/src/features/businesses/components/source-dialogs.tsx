import { useState } from 'react';
import { Ban, Trash2, Undo2 } from 'lucide-react';
import {
  sourceBlockValue,
  SourceBlockKind,
  type RemoveSourceInput,
  type WebSource,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/format';
import { notify } from '@/stores/notifications';
import {
  useBlocklist,
  useBlockSource,
  useCanEditBusiness,
  useRemoveSource,
  useUnblockSource,
} from '../api/businesses';

type SourceTarget = { business: string } | { discovery: string };
type RemoveMode = NonNullable<RemoveSourceInput['block']>;

/** Research sources with a remove / blacklist action per row (content writers only). */
export function SourceList({
  sources,
  target,
  className,
}: {
  sources: WebSource[];
  target: SourceTarget;
  className?: string;
}) {
  const t = useT();
  const { can } = useAuthorization();
  const canEditBusiness = useCanEditBusiness('business' in target ? target.business : undefined);
  // a discovery is private to whoever ran it, so the global role decides there
  const editable = 'business' in target ? canEditBusiness : can('content:write');
  const [removing, setRemoving] = useState<WebSource | null>(null);

  return (
    <>
      <ul className={cn('space-y-1.5 px-5 py-4 text-xs', className)}>
        {sources.map((s) => (
          <li key={s.url} className="group flex min-w-0 items-center gap-1">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 flex-1 truncate text-primary hover:underline"
              title={s.url}
            >
              {s.title || s.url}
            </a>
            {editable && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-6 shrink-0 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t('businesses.sourceActions.remove')}
                title={t('businesses.sourceActions.remove')}
                onClick={() => setRemoving(s)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {removing && (
        <RemoveSourceDialog
          source={removing}
          target={target}
          onOpenChange={(v) => !v && setRemoving(null)}
        />
      )}
    </>
  );
}

/** Remove one source: only here, or also blacklist the page / whole site. Mounted only while open. */
function RemoveSourceDialog({
  source,
  target,
  onOpenChange,
}: {
  source: WebSource;
  target: SourceTarget;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const { can } = useAuthorization();
  const canBlock = can('source:block');
  const remove = useRemoveSource(target);
  const [mode, setMode] = useState<RemoveMode>('NONE');
  const pageValue = sourceBlockValue(source.url, 'URL');
  const domainValue = sourceBlockValue(source.url, 'DOMAIN');

  const options: { mode: RemoveMode; label: string; hint: string; disabled?: boolean }[] = [
    {
      mode: 'NONE',
      label: t('businesses.sourceActions.modeNone'),
      hint: t('businesses.sourceActions.modeNoneHint'),
    },
    {
      mode: 'URL',
      label: t('businesses.sourceActions.modeUrl'),
      hint: t('businesses.sourceActions.modeUrlHint', { value: pageValue ?? '' }),
      disabled: !canBlock || !pageValue,
    },
    {
      mode: 'DOMAIN',
      label: t('businesses.sourceActions.modeDomain'),
      hint: t('businesses.sourceActions.modeDomainHint', { value: domainValue ?? '' }),
      disabled: !canBlock || !domainValue,
    },
  ];

  const submit = () =>
    remove.mutate(
      { url: source.url, block: mode },
      {
        onSuccess: (r) => {
          notify.success(
            r.blocked
              ? t('businesses.sourceActions.blocked')
              : t('businesses.sourceActions.removed'),
          );
          onOpenChange(false);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.sourceActions.title')}
      description={t('businesses.sourceActions.body')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            icon={mode === 'NONE' ? <Trash2 /> : <Ban />}
            isLoading={remove.isPending}
            onClick={submit}
          >
            {options.find((o) => o.mode === mode)!.label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="break-all rounded-md bg-muted px-3 py-2 text-xs" dir="ltr">
          {source.title && source.title !== source.url && (
            <span className="block font-medium" dir="auto">
              {source.title}
            </span>
          )}
          <span className="text-muted-foreground">{source.url}</span>
        </p>
        <fieldset className="space-y-2">
          {options.map((o) => (
            <label
              key={o.mode}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition',
                mode === o.mode ? 'border-primary bg-primary/5' : 'hover:bg-muted',
                o.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              <input
                type="radio"
                name="remove-mode"
                className="mt-1 accent-primary"
                checked={mode === o.mode}
                disabled={o.disabled}
                onChange={() => setMode(o.mode)}
              />
              <span className="min-w-0">
                <span className="block font-medium">{o.label}</span>
                <span className="block break-all text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {!canBlock && (
          <p className="text-xs text-muted-foreground">
            {t('businesses.sourceActions.blockAdminOnly')}
          </p>
        )}
        {canBlock && !domainValue && (
          <p className="text-xs text-muted-foreground">
            {t('businesses.sourceActions.invalidUrl')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The global research-source blacklist: list, add, unblock. Mounted only while open. */
export function BlocklistDialog({ onOpenChange }: { onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const { can } = useAuthorization();
  const canBlock = can('source:block');
  const { data, isLoading } = useBlocklist();
  const block = useBlockSource();
  const unblock = useUnblockSource();
  const [kind, setKind] = useState<SourceBlockKind>('DOMAIN');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const valid = !!sourceBlockValue(value, kind);

  const add = () =>
    block.mutate(
      { kind, value: value.trim(), note: note.trim() },
      {
        onSuccess: () => {
          notify.success(t('businesses.blocklist.added'));
          setValue('');
          setNote('');
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.blocklist.title')}
      description={t('businesses.blocklist.subtitle')}
      className="max-w-2xl"
    >
      <div className="space-y-5">
        {canBlock && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
              <Field label={t('businesses.blocklist.kind')}>
                {(id) => (
                  <Select
                    id={id}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as SourceBlockKind)}
                    options={SourceBlockKind.map((k) => ({
                      value: k,
                      label: t(`enums.sourceBlockKind.${k}`),
                    }))}
                  />
                )}
              </Field>
              <Field
                label={t('businesses.blocklist.value')}
                hint={t('businesses.blocklist.valueHint')}
              >
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
                    value={value}
                    maxLength={2000}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && valid) add();
                    }}
                  />
                )}
              </Field>
            </div>
            <Field label={t('businesses.blocklist.note')} optional={t('common.optional')}>
              {(id) => (
                <Input
                  id={id}
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button icon={<Ban />} disabled={!valid} isLoading={block.isPending} onClick={add}>
                {t('businesses.blocklist.add')}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : !data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('businesses.blocklist.empty')}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`enums.sourceBlockKind.${r.kind}`)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-all font-medium" dir="ltr">
                    {r.value}
                  </p>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.createdAt)}
                    {r.createdBy &&
                      ` · ${t('businesses.blocklist.by', { name: r.createdBy.name })}`}
                  </p>
                </div>
                {canBlock && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('businesses.blocklist.unblock')}
                    title={t('businesses.blocklist.unblock')}
                    disabled={unblock.isPending}
                    onClick={() =>
                      unblock.mutate(r.id, {
                        onSuccess: () => notify.success(t('businesses.blocklist.unblocked')),
                        onError: (e) => notify.error(t('common.error'), e.message),
                      })
                    }
                  >
                    <Undo2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
