import { useRef, useState } from 'react';
import {
  Clapperboard,
  ExternalLink,
  FileText,
  FileUp,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  assetFileType,
  BUSINESS_ASSET_TEXT_MAX_CHARS,
  BusinessAssetKind,
  VIDEO_ASSET_KINDS,
  type BusinessAsset,
} from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import {
  useAnalyzeAsset,
  useAsset,
  useAssets,
  useCanEditBusiness,
  useCreateAsset,
  useDeleteAsset,
  useUpdateAsset,
} from '../api/businesses';
import { imagePreviews, videoPreviews } from '../media-previews';

const isVideoKind = (kind: BusinessAssetKind) => VIDEO_ASSET_KINDS.includes(kind);
const kindIcon = (kind: BusinessAssetKind) =>
  kind === 'ARTICLE' ? FileText : isVideoKind(kind) ? Clapperboard : ImageIcon;
const megabytes = (bytes: number) => formatNumber(bytes / 1024 / 1024, 1);

/** Add one past piece: a file (image / video), a link, and/or its text. Mounted only while open. */
function AddAssetDialog({
  businessId,
  onOpenChange,
}: {
  businessId: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateAsset(businessId);
  const picker = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<BusinessAssetKind>('IMAGE');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<Blob[]>([]);
  const [preparing, setPreparing] = useState(false);

  const article = kind === 'ARTICLE';
  const fileType = file ? assetFileType(file.name) : null;
  const urlOk = !url.trim() || /^https?:\/\/\S+$/i.test(url.trim());
  const hasPayload = !!file || (!!url.trim() && urlOk) || !!text.trim();
  const valid = hasPayload && urlOk && !preparing;

  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    const type = assetFileType(picked.name);
    if (!type) {
      notify.error(t('businesses.assets.badFile'));
      return;
    }
    setFile(picked);
    setPreviews([]);
    if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
    // Keep the chosen kind in step with the file, unless the admin already picked a fitting one.
    if (type === 'video' && !isVideoKind(kind)) setKind('VIDEO');
    if (type === 'image' && (isVideoKind(kind) || article)) setKind('IMAGE');
    setPreparing(true);
    try {
      setPreviews(type === 'video' ? await videoPreviews(picked) : await imagePreviews(picked));
    } finally {
      setPreparing(false);
    }
  };

  const submit = () => {
    const form = new FormData();
    form.set('kind', kind);
    form.set('title', title.trim());
    form.set('description', description.trim());
    form.set('url', url.trim());
    form.set('text', text.trim());
    if (file) form.set('file', file);
    previews.forEach((p, i) => form.append('previews', p, `preview-${i + 1}.jpg`));
    create.mutate(form, {
      onSuccess: () => {
        notify.info(t('businesses.assets.added'));
        onOpenChange(false);
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.assets.addTitle')}
      description={t('businesses.assets.addSubtitle')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button icon={<Plus />} disabled={!valid} isLoading={create.isPending} onClick={submit}>
            {t('businesses.assets.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <Field label={t('businesses.assets.kind')}>
            {(id) => (
              <Select
                id={id}
                value={kind}
                onChange={(e) => setKind(e.target.value as BusinessAssetKind)}
                options={BusinessAssetKind.map((k) => ({
                  value: k,
                  label: t(`enums.businessAssetKind.${k}`),
                }))}
              />
            )}
          </Field>
          <Field label={t('businesses.assets.titleField')} optional={t('common.optional')}>
            {(id) => (
              <Input
                id={id}
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
        </div>

        {!article && (
          <div className="space-y-2 rounded-lg border border-dashed p-4">
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov,.m4v"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<FileUp />}
                onClick={() => picker.current?.click()}
              >
                {file ? t('businesses.assets.changeFile') : t('businesses.assets.chooseFile')}
              </Button>
              {file && (
                <span className="min-w-0 truncate text-xs text-muted-foreground" dir="ltr">
                  {file.name} · {megabytes(file.size)} MB
                </span>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('businesses.assets.fileHint')}
            </p>
            {preparing && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner size="sm" /> {t('businesses.assets.preparing')}
              </p>
            )}
            {file && !preparing && previews.length === 0 && (
              <p className="flex items-start gap-1.5 text-xs leading-5 text-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {t(
                  fileType === 'video'
                    ? 'businesses.assets.noFrames'
                    : 'businesses.assets.noPreview',
                )}
              </p>
            )}
            {previews.length > 0 && (
              <PreviewStrip key={`${file?.name}:${file?.size}`} blobs={previews} />
            )}
          </div>
        )}

        <Field
          label={t('businesses.assets.url')}
          hint={t('businesses.assets.urlHint')}
          optional={t('common.optional')}
          error={urlOk ? undefined : t('businesses.assets.badUrl')}
        >
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              value={url}
              maxLength={2000}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.assets.description')}
          hint={t('businesses.assets.descriptionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              dir="auto"
              value={description}
              maxLength={4000}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t(article ? 'businesses.assets.articleText' : 'businesses.assets.text')}
          hint={t(article ? 'businesses.assets.articleTextHint' : 'businesses.assets.textHint')}
          optional={article ? undefined : t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={article ? 9 : 3}
              dir="auto"
              value={text}
              maxLength={BUSINESS_ASSET_TEXT_MAX_CHARS}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        {!hasPayload && (
          <p className="text-xs text-muted-foreground">{t('businesses.assets.needPayload')}</p>
        )}
      </div>
    </Dialog>
  );
}

/** Thumbnails of freshly made previews (object URLs live as long as the strip is mounted). */
function PreviewStrip({ blobs }: { blobs: Blob[] }) {
  const [urls] = useState(() => blobs.map((b) => URL.createObjectURL(b)));
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u) => (
        <img key={u} src={u} alt="" className="h-20 rounded border object-cover" />
      ))}
    </div>
  );
}

/** The piece itself, the AI analysis, and the fields the admin can correct. Mounted while open. */
function AssetDialog({
  asset,
  businessId,
  editable,
  onOpenChange,
}: {
  asset: BusinessAsset;
  businessId: string;
  editable: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const full = useAsset(asset.id);
  const update = useUpdateAsset(businessId);
  const analyze = useAnalyzeAsset(businessId);
  const [description, setDescription] = useState(asset.description);
  const [text, setText] = useState<string | null>(null);
  const loadedText = full.data?.text ?? '';
  const currentText = text ?? loadedText;
  const dirty = description !== asset.description || (text !== null && text !== loadedText);
  const a = asset.analysis;
  const video = asset.mimeType?.startsWith('video/');

  const save = (thenAnalyze: boolean) =>
    update.mutate(
      { id: asset.id, data: { description, ...(text !== null ? { text } : {}) } },
      {
        onSuccess: () => {
          if (!thenAnalyze) return notify.success(t('common.saved'));
          analyze.mutate(asset.id, {
            onSuccess: () => {
              notify.info(t('businesses.assets.analyzing'));
              onOpenChange(false);
            },
            onError: (e) => notify.error(t('common.error'), e.message),
          });
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={asset.title || t(`enums.businessAssetKind.${asset.kind}`)}
      description={t(`enums.businessAssetKind.${asset.kind}`)}
      className="max-w-3xl"
      footer={
        editable && (
          <>
            <Button
              variant="outline"
              disabled={!dirty}
              isLoading={update.isPending}
              onClick={() => save(false)}
            >
              {t('common.save')}
            </Button>
            <Button
              icon={<RefreshCw />}
              isLoading={analyze.isPending}
              disabled={asset.analysisStatus === 'QUEUED'}
              onClick={() => save(true)}
            >
              {t('businesses.assets.reanalyze')}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {asset.fileUrl && video ? (
          <video
            src={asset.fileUrl}
            controls
            preload="metadata"
            poster={asset.previewUrls[0]}
            className="max-h-[50vh] w-full rounded-lg bg-black"
          />
        ) : (
          (asset.fileUrl ?? asset.previewUrls[0]) && (
            <img
              src={asset.fileUrl ?? asset.previewUrls[0]}
              alt={asset.title}
              className="max-h-[50vh] w-full rounded-lg border object-contain"
            />
          )
        )}
        {asset.url && (
          <a
            href={asset.url}
            target="_blank"
            rel="noreferrer noopener"
            dir="ltr"
            className="flex items-center gap-1 break-all text-xs text-primary hover:underline"
          >
            {asset.url} <ExternalLink className="size-3 shrink-0" />
          </a>
        )}

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {t('businesses.assets.analysis')}
            <Badge tone={statusTone[asset.analysisStatus]}>
              {t(`enums.assetAnalysisStatus.${asset.analysisStatus}`)}
            </Badge>
          </h3>
          {asset.analysisStatus === 'FAILED' && asset.analysisError && (
            <p className="text-xs leading-5 text-destructive" dir="auto">
              {asset.analysisError}
            </p>
          )}
          {a ? (
            <dl className="space-y-2 rounded-lg bg-muted p-4 text-xs leading-6">
              {(
                [
                  ['summary', a.summary],
                  ['visualStyle', a.visualStyle],
                  ['tone', a.tone],
                  ['structure', a.structure],
                  ['messages', a.messages.join(' • ')],
                  ['copy', a.copy],
                  ['guidelines', a.guidelines.join(' • ')],
                  ['bestFor', a.bestFor],
                ] as const
              ).map(([k, v]) =>
                v && v !== 'n/a' ? (
                  <div key={k}>
                    <dt className="font-medium">{t(`businesses.assets.fields.${k}`)}</dt>
                    <dd dir="auto" className="text-muted-foreground">
                      {v}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            asset.analysisStatus !== 'FAILED' && (
              <p className="text-xs text-muted-foreground">{t('businesses.assets.noAnalysis')}</p>
            )
          )}
        </section>

        <Field
          label={t('businesses.assets.description')}
          hint={t('businesses.assets.descriptionHint')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              dir="auto"
              value={description}
              maxLength={4000}
              readOnly={!editable}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('businesses.assets.text')} hint={t('businesses.assets.textHint')}>
          {(id) =>
            full.isLoading ? (
              <Spinner size="sm" />
            ) : (
              <Textarea
                id={id}
                rows={asset.kind === 'ARTICLE' ? 10 : 4}
                dir="auto"
                value={currentText}
                maxLength={BUSINESS_ASSET_TEXT_MAX_CHARS}
                readOnly={!editable}
                onChange={(e) => setText(e.target.value)}
              />
            )
          }
        </Field>
      </div>
    </Dialog>
  );
}

/** Past content of the business that AI learns from: grid, add, inspect, toggle, delete. */
export function AssetsPanel({ businessId }: { businessId: string }) {
  const t = useT();
  const editable = useCanEditBusiness(businessId);
  const { data, isLoading } = useAssets(businessId);
  const update = useUpdateAsset(businessId);
  const remove = useDeleteAsset(businessId);
  const [addOpen, setAddOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = data?.find((a) => a.id === viewingId);

  return (
    <Card>
      <CardHeader
        title={t('businesses.assets.title')}
        description={t('businesses.assets.hint')}
        actions={
          editable && (
            <Button size="sm" icon={<Plus />} onClick={() => setAddOpen(true)}>
              {t('businesses.assets.add')}
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !data?.length ? (
        <p className="px-5 py-6 text-sm leading-7 text-muted-foreground">
          {t('businesses.assets.empty')}
        </p>
      ) : (
        <ul className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((asset) => {
            const Icon = kindIcon(asset.kind);
            const thumb = asset.previewUrls[0];
            return (
              <li
                key={asset.id}
                className={cn(
                  'flex flex-col overflow-hidden rounded-lg border',
                  !asset.isActive && 'opacity-60',
                )}
              >
                <button
                  type="button"
                  className="relative flex aspect-video items-center justify-center bg-muted"
                  onClick={() => setViewingId(asset.id)}
                  aria-label={asset.title || t(`enums.businessAssetKind.${asset.kind}`)}
                >
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Icon className="size-8 text-muted-foreground" />
                  )}
                  <span className="absolute start-2 top-2">
                    <Badge tone="neutral">{t(`enums.businessAssetKind.${asset.kind}`)}</Badge>
                  </span>
                </button>
                <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
                  <p className="truncate font-medium" dir="auto">
                    {asset.title || t(`enums.businessAssetKind.${asset.kind}`)}
                  </p>
                  <p
                    className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground"
                    dir="auto"
                  >
                    {asset.analysis?.summary ?? asset.description}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <Badge tone={statusTone[asset.analysisStatus]}>
                      {t(`enums.assetAnalysisStatus.${asset.analysisStatus}`)}
                    </Badge>
                    {editable && (
                      <span className="flex items-center gap-1">
                        <span title={t('businesses.assets.active')}>
                          <Switch
                            checked={asset.isActive}
                            disabled={update.isPending}
                            onCheckedChange={(isActive) =>
                              update.mutate({ id: asset.id, data: { isActive } })
                            }
                          />
                        </span>
                        <ConfirmationDialog
                          body={t('businesses.assets.deleteBody')}
                          isLoading={remove.isPending}
                          trigger={
                            <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                              <Trash2 />
                            </Button>
                          }
                          onConfirm={() =>
                            remove
                              .mutateAsync(asset.id)
                              .catch((e: Error) => notify.error(t('common.error'), e.message))
                          }
                        />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {addOpen && <AddAssetDialog businessId={businessId} onOpenChange={setAddOpen} />}
      {viewing && (
        <AssetDialog
          key={`${viewing.id}:${viewing.analysisStatus}`}
          asset={viewing}
          businessId={businessId}
          editable={editable}
          onOpenChange={(v) => !v && setViewingId(null)}
        />
      )}
    </Card>
  );
}
