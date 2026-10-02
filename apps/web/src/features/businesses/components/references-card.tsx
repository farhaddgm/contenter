import { useRef, useState } from 'react';
import {
  BookOpen,
  Eye,
  FileText,
  FileUp,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  BUSINESS_REFERENCE_MAX_CHARS,
  parseGoogleFileUrl,
  type BusinessReference,
  type ReferenceKind,
} from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Switch, Textarea } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';
import {
  useAddReference,
  useDeleteReference,
  useDriveStatus,
  useReference,
  useReferences,
  useRefreshReference,
  useUpdateReference,
} from '../api/businesses';
import { ConnectDriveButton } from './google-drive-card';

const KIND_ICON: Record<ReferenceKind, typeof Globe> = {
  URL: Globe,
  GOOGLE_DOC: FileText,
  TEXT: BookOpen,
};

/** Lines of a textarea that look like http(s) links, and the ones that do not. */
export function splitLinks(raw: string): { links: string[]; invalid: string[] } {
  const lines = raw
    .split(/\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ok = (l: string) => {
    try {
      return /^https?:$/.test(new URL(l).protocol);
    } catch {
      return false;
    }
  };
  return { links: [...new Set(lines.filter(ok))], invalid: lines.filter((l) => !ok(l)) };
}

/** Hint under a link field: Google files need a connected account when they are private. */
export function GoogleLinkHint({ links }: { links: string[] }) {
  const t = useT();
  const { can } = useAuthorization();
  const { data } = useDriveStatus();
  if (!links.some((l) => parseGoogleFileUrl(l))) return null;
  const emails = data?.accounts.filter((a) => !a.error).map((a) => a.email) ?? [];
  return (
    <div className="space-y-2 rounded-md bg-primary/5 px-3 py-2 text-xs leading-6">
      <p>
        <span className="font-medium">{t('businesses.references.googleDetected')}</span>{' '}
        {emails.length
          ? t('businesses.references.googleAccounts', { emails: emails.join('، ') })
          : t('businesses.references.googleNeedsAccount')}
      </p>
      {can('backoffice:access') ? (
        data?.configured ? (
          <ConnectDriveButton another={emails.length > 0} />
        ) : (
          <p className="text-muted-foreground">{t('businesses.drive.notConfigured')}</p>
        )
      ) : (
        !emails.length && <p className="text-muted-foreground">{t('businesses.drive.adminOnly')}</p>
      )}
    </div>
  );
}

/** Reads a .txt / .md file into a string (capped at the reference limit). */
export function TextFileButton({ onLoad }: { onLoad: (text: string, name: string) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void file
            .text()
            .then((text) =>
              onLoad(
                text.slice(0, BUSINESS_REFERENCE_MAX_CHARS),
                file.name.replace(/\.[^.]+$/, ''),
              ),
            );
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        icon={<FileUp />}
        onClick={() => input.current?.click()}
      >
        {t('businesses.references.upload')}
      </Button>
    </>
  );
}

/** Add links (one per line) or a pasted/uploaded text. Mounted only while open. */
function AddReferenceDialog({
  businessId,
  onOpenChange,
}: {
  businessId: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const add = useAddReference(businessId);
  const [tab, setTab] = useState<'link' | 'text'>('link');
  const [urls, setUrls] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { links, invalid } = splitLinks(urls);
  const valid = tab === 'link' ? links.length > 0 && !invalid.length : text.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    try {
      const inputs =
        tab === 'link'
          ? links.map((url) => ({ url }))
          : [{ content: text.trim(), title: title.trim() }];
      const results = await Promise.allSettled(inputs.map((i) => add.mutateAsync(i)));
      const rejected = results.filter((r) => r.status === 'rejected');
      const added = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.references : []));
      const skipped = results.reduce(
        (n, r) => n + (r.status === 'fulfilled' ? r.value.skipped : 0),
        0,
      );
      const unread = added.filter((r) => r.status !== 'READY').length;
      if (skipped) notify.info(t('businesses.references.folderSkipped', { count: skipped }));
      if (rejected.length) {
        notify.error(t('common.error'), (rejected[0] as PromiseRejectedResult).reason?.message);
      }
      if (unread) notify.warning(t('businesses.references.someFailed', { failed: unread }));
      else if (!rejected.length) notify.success(t('businesses.references.added'));
      if (rejected.length < results.length) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.references.addTitle')}
      description={t('businesses.references.addSubtitle')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button icon={<Plus />} disabled={!valid} isLoading={busy} onClick={() => void submit()}>
            {t('businesses.references.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'link', label: t('businesses.references.tabLink') },
            { value: 'text', label: t('businesses.references.tabText') },
          ]}
        />
        {tab === 'link' ? (
          <>
            <Field
              label={t('businesses.references.url')}
              hint={t('businesses.references.urlHint')}
              error={
                invalid.length
                  ? t('businesses.fromSources.invalidLinks', {
                      lines: invalid.slice(0, 3).join(' , '),
                    })
                  : undefined
              }
            >
              {(id) => (
                <Textarea
                  id={id}
                  autoFocus
                  rows={4}
                  dir="ltr"
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                />
              )}
            </Field>
            <GoogleLinkHint links={links} />
          </>
        ) : (
          <>
            <Field label={t('businesses.references.titleField')} optional={t('common.optional')}>
              {(id) => (
                <Input
                  id={id}
                  value={title}
                  maxLength={300}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('businesses.references.text')}
              hint={t('businesses.references.textHint')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={10}
                  dir="auto"
                  value={text}
                  maxLength={BUSINESS_REFERENCE_MAX_CHARS}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </Field>
            <TextFileButton
              onLoad={(content, name) => {
                setText(content);
                if (!title) setTitle(name);
              }}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The stored snapshot — exactly what AI reads. Mounted only while open. */
function ReferenceViewDialog({
  reference,
  onOpenChange,
}: {
  reference: BusinessReference;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const { data, isLoading } = useReference(reference.id);
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.references.viewTitle')}
      description={reference.title || reference.url}
      className="max-w-3xl"
    >
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('businesses.references.chars', { count: formatNumber(data.chars) })}
            {data.fetchedAt &&
              ` · ${t('businesses.references.fetchedAt', { date: formatDate(data.fetchedAt) })}`}
            {data.googleAccount &&
              ` · ${t('businesses.references.readWith', { email: data.googleAccount.email })}`}
          </p>
          <pre
            dir="auto"
            className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs leading-6"
          >
            {data.content}
          </pre>
        </div>
      )}
    </Dialog>
  );
}

/** The admin's own sources for AI: list, add, view snapshot, refresh, enable/disable, delete. */
export function ReferencesCard({ businessId }: { businessId: string }) {
  const t = useT();
  const { can } = useAuthorization();
  const editable = can('content:write');
  const { data, isLoading } = useReferences(businessId);
  const update = useUpdateReference(businessId);
  const refresh = useRefreshReference(businessId);
  const remove = useDeleteReference(businessId);
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState<BusinessReference | null>(null);

  return (
    <Card>
      <CardHeader
        title={t('businesses.references.title')}
        description={t('businesses.references.hint')}
        actions={
          editable && (
            <Button size="sm" variant="outline" icon={<Plus />} onClick={() => setAddOpen(true)}>
              {t('businesses.references.add')}
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : !data?.length ? (
        <p className="px-5 py-4 text-xs leading-6 text-muted-foreground">
          {t('businesses.references.empty')}
        </p>
      ) : (
        <ul className="divide-y">
          {data.map((r) => {
            const Icon = KIND_ICON[r.kind];
            const refreshing = refresh.isPending && refresh.variables === r.id;
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium" dir="auto">
                      {r.title || r.url || t('businesses.references.pastedText')}
                    </span>
                    <Badge tone={statusTone[r.status]}>
                      {t(`enums.referenceStatus.${r.status}`)}
                    </Badge>
                  </p>
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      dir="ltr"
                      className="block truncate text-xs text-primary hover:underline"
                    >
                      {r.url}
                    </a>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(`enums.referenceKind.${r.kind}`)}
                    {r.chars > 0 &&
                      ` · ${t('businesses.references.chars', { count: formatNumber(r.chars) })}`}
                    {r.googleAccount &&
                      ` · ${t('businesses.references.readWith', { email: r.googleAccount.email })}`}
                  </p>
                  {r.status === 'FAILED' && r.error && (
                    <p className="flex items-start gap-1.5 text-xs leading-5 text-destructive">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span dir="auto">{r.error}</span>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {editable && r.status === 'READY' && (
                    <span title={t('businesses.references.active')}>
                      <Switch
                        checked={r.isActive}
                        disabled={update.isPending}
                        onCheckedChange={(isActive) =>
                          update.mutate({ id: r.id, data: { isActive } })
                        }
                      />
                    </span>
                  )}
                  {r.chars > 0 && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('businesses.references.view')}
                      title={t('businesses.references.view')}
                      onClick={() => setViewing(r)}
                    >
                      <Eye />
                    </Button>
                  )}
                  {editable && r.kind !== 'TEXT' && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('businesses.references.refresh')}
                      title={t('businesses.references.refresh')}
                      isLoading={refreshing}
                      icon={<RefreshCw />}
                      onClick={() =>
                        refresh.mutate(r.id, {
                          onSuccess: ({ references }) => {
                            const failed = references.find((x) => x.status !== 'READY');
                            if (failed) {
                              notify.error(
                                t('businesses.references.refreshFailed'),
                                failed.error ?? undefined,
                              );
                            } else notify.success(t('businesses.references.refreshed'));
                          },
                          onError: (e) => notify.error(t('common.error'), e.message),
                        })
                      }
                    />
                  )}
                  {editable && (
                    <ConfirmationDialog
                      body={t('businesses.references.deleteBody')}
                      isLoading={remove.isPending}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                          <Trash2 />
                        </Button>
                      }
                      onConfirm={() =>
                        remove
                          .mutateAsync(r.id)
                          .catch((e: Error) => notify.error(t('common.error'), e.message))
                      }
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {addOpen && <AddReferenceDialog businessId={businessId} onOpenChange={setAddOpen} />}
      {viewing && (
        <ReferenceViewDialog reference={viewing} onOpenChange={(v) => !v && setViewing(null)} />
      )}
    </Card>
  );
}
