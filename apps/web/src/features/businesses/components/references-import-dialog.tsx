import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import {
  REFERENCE_LIST_MAX,
  type ImportReferencesInput,
  type ImportReferencesResult,
  type ReferenceAudience,
  type ReferencePreviewItem,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { CopyButton } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { api } from '@/lib/api-client';
import { notify } from '@/stores/notifications';
import { businessKeys, useDriveStatus } from '../api/businesses';
import { AudienceFields, splitLinks } from './references-card';

const TONE = {
  READY: 'success',
  NO_ACCESS: 'danger',
  DUPLICATE: 'neutral',
  REJECTED: 'danger',
  UNCHECKED: 'neutral',
} as const;

/** What the admin may tick: a row that can be added (duplicates and rejected rows cannot). */
const canTick = (state: ReferencePreviewItem['state']) =>
  state === 'READY' || state === 'UNCHECKED' || state === 'NO_ACCESS';
/** Ticked from the start: only what is known to work. */
const tickedByDefault = (state: ReferencePreviewItem['state']) =>
  state === 'READY' || state === 'UNCHECKED';

/** A row of the review table: one link, or one file of a folder. */
interface Row {
  url: string;
  title: string;
  state: ReferencePreviewItem['state'];
  reason: string | null;
  indent: boolean;
}

function toRows(items: ReferencePreviewItem[]): { head?: ReferencePreviewItem; rows: Row[] }[] {
  return items.map((i) =>
    i.kind === 'GOOGLE_FOLDER' && i.files.length
      ? {
          head: i,
          rows: i.files.map((f) => ({
            url: f.url,
            title: f.title,
            state: f.duplicate ? ('DUPLICATE' as const) : ('READY' as const),
            reason: f.duplicate ? 'Already a reference' : null,
            indent: true,
          })),
        }
      : {
          rows: [{ url: i.url, title: i.title, state: i.state, reason: i.reason, indent: false }],
        },
  );
}

/**
 * Adds many documents at once (docs/77 phase 3): paste a list of links, look at what the server
 * can open, tick or untick each one, then confirm. Nothing is saved before the confirm.
 * Mounted only while open.
 */
export function ImportReferencesDialog({
  businessId,
  onOpenChange,
}: {
  businessId: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: drive } = useDriveStatus();
  const shareEmail =
    drive?.serviceAccountEmail ?? drive?.accounts.find((a) => !a.error)?.email ?? null;
  const [raw, setRaw] = useState('');
  const [items, setItems] = useState<ReferencePreviewItem[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<ReferenceAudience>('AI');
  const { links, invalid } = splitLinks(raw);

  const preview = useMutation({
    mutationFn: (urls: string[]) =>
      api.post<ReferencePreviewItem[]>(`/businesses/${businessId}/references/preview`, { urls }),
    onSuccess: (data) => {
      setItems(data);
      setTicked(
        new Set(
          toRows(data)
            .flatMap((g) => g.rows)
            .filter((r) => tickedByDefault(r.state))
            .map((r) => r.url),
        ),
      );
    },
    onError: (e: Error) => notify.error(t('common.error'), e.message),
  });

  const run = useMutation({
    mutationFn: (input: ImportReferencesInput) =>
      api.post<ImportReferencesResult>(`/businesses/${businessId}/references/import`, input),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: businessKeys.references(businessId) });
      void qc.invalidateQueries({ queryKey: ['business-references'] });
      if (res.failed) {
        notify.warning(
          t('businesses.references.listPartial', { added: res.added, failed: res.failed }),
          res.results.find((r) => !r.ok)?.error ?? undefined,
        );
      } else notify.success(t('businesses.references.listDone', { added: res.added }));
      onOpenChange(false);
    },
    onError: (e: Error) => notify.error(t('common.error'), e.message),
  });

  const groups = items ? toRows(items) : [];
  const all = groups.flatMap((g) => g.rows).filter((r) => canTick(r.state));
  const titleOf = new Map(all.map((r) => [r.url, r.title]));
  const toggle = (url: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(url);
      else next.delete(url);
      return next;
    });
  const chosen = all.filter((r) => ticked.has(r.url));

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.references.listTitle')}
      description={t('businesses.references.listHint', { max: REFERENCE_LIST_MAX })}
      descriptionAsTip
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {items ? (
            <>
              <Button variant="outline" onClick={() => setItems(null)}>
                {t('businesses.references.listBack')}
              </Button>
              <Button
                icon={<Plus />}
                disabled={!chosen.length}
                isLoading={run.isPending}
                onClick={() =>
                  run.mutate({
                    items: chosen.map((r) => ({ url: r.url, title: titleOf.get(r.url) ?? '' })),
                    description: description.trim(),
                    audience,
                  })
                }
              >
                {t('businesses.references.listAddN', { count: chosen.length })}
              </Button>
            </>
          ) : (
            <Button
              icon={<Search />}
              disabled={!links.length || !!invalid.length || links.length > REFERENCE_LIST_MAX}
              isLoading={preview.isPending}
              onClick={() => preview.mutate(links)}
            >
              {t('businesses.references.listCheck')}
            </Button>
          )}
        </>
      }
    >
      {!items ? (
        <Field
          label={t('businesses.references.url')}
          hint={t('businesses.references.urlHint')}
          error={
            invalid.length
              ? t('businesses.fromSources.invalidLinks', { lines: invalid.slice(0, 3).join(' , ') })
              : links.length > REFERENCE_LIST_MAX
                ? t('businesses.references.listTooMany', { max: REFERENCE_LIST_MAX })
                : undefined
          }
        >
          {(id) => (
            <Textarea
              id={id}
              autoFocus
              rows={8}
              dir="ltr"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {t('businesses.references.listTicked', { count: chosen.length, total: all.length })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setTicked(new Set(all.map((r) => r.url)))}
            >
              {t('businesses.references.listSelectAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
              {t('businesses.references.listSelectNone')}
            </Button>
          </div>
          <ul className="max-h-[45vh] divide-y overflow-auto rounded-md border">
            {groups.map((g, gi) => (
              <li key={g.head?.url ?? g.rows[0]!.url + gi}>
                {g.head && (
                  <p className="bg-muted/50 px-3 py-2 text-xs font-medium" data-bidi="">
                    {t('businesses.references.listFolder', {
                      name: g.head.title || g.head.url,
                      count: g.head.files.length,
                    })}
                    {g.head.skipped > 0 &&
                      ` · ${t('businesses.references.listSkipped', { count: g.head.skipped })}`}
                    {g.head.truncated && ` · ${t('businesses.references.listTruncated')}`}
                  </p>
                )}
                {
                  <ul>
                    {g.rows.map((r) => (
                      <li
                        key={r.url}
                        className={`flex flex-wrap items-start gap-3 px-3 py-2 text-sm ${r.indent ? 'ps-8' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          disabled={!canTick(r.state)}
                          checked={ticked.has(r.url)}
                          aria-label={r.title || r.url}
                          onChange={(e) => toggle(r.url, e.target.checked)}
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium" data-bidi="">
                              {r.title || r.url}
                            </span>
                            <Badge tone={TONE[r.state]}>
                              {t(`businesses.references.listState.${r.state}`)}
                            </Badge>
                          </p>
                          {!r.indent && r.title && (
                            <span
                              className="block truncate text-xs text-muted-foreground"
                              dir="ltr"
                            >
                              {r.url}
                            </span>
                          )}
                          {r.reason && r.state !== 'NO_ACCESS' && (
                            <p className="text-xs leading-5 text-muted-foreground" data-bidi="">
                              {r.reason}
                            </p>
                          )}
                          {r.state === 'NO_ACCESS' && (
                            <p className="flex flex-wrap items-center gap-2 text-xs leading-5">
                              <span>
                                {shareEmail
                                  ? t('businesses.references.shareWith', { email: shareEmail })
                                  : t('businesses.references.noAccessNoAccount')}
                              </span>
                              {shareEmail && <CopyButton text={shareEmail} />}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                }
              </li>
            ))}
          </ul>
          <AudienceFields
            description={description}
            audience={audience}
            onDescription={setDescription}
            onAudience={setAudience}
          />
        </div>
      )}
    </Dialog>
  );
}
