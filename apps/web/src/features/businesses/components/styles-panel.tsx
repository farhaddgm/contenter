import { useState } from 'react';
import {
  AtSign,
  BookOpen,
  Check,
  ChevronDown,
  Eye,
  Globe,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import {
  BUSINESS_REFERENCE_MAX_CHARS,
  BUSINESS_STYLE_LIMIT,
  STYLE_GUIDE_MAX_CHARS,
  STYLE_SOURCE_LIMIT,
  instagramProfileUrl,
  parseInstagramHandle,
  type BusinessStyleDetail,
  type BusinessStyleSummary,
  type StyleSourceKind,
  type StyleSourceSummary,
} from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Switch, Textarea } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { useCanEditBusiness, useInstagramStatus } from '../api/businesses';
import {
  styleKeys,
  useAddStyleSource,
  useBuildStyle,
  useCreateStyle,
  useDeleteStyle,
  useDeleteStyleSource,
  useRefreshStyleSource,
  useReviewStyle,
  useStyle,
  useStyleSourceText,
  useStyles,
  useUpdateStyle,
} from '../api/styles';
import {
  EMPTY_MANUAL,
  InstagramManualFields,
  toManualInput,
  type ManualInstagramState,
} from './presence-parts';
import { splitLinks, TextFileButton } from './references-card';

const KIND_ICON: Record<StyleSourceKind, typeof Globe> = {
  INSTAGRAM: AtSign,
  WEBSITE: Globe,
  URL: Globe,
  TEXT: BookOpen,
};

const STATE_TONE: Record<BusinessStyleSummary['buildState'], BadgeTone> = {
  NONE: 'neutral',
  BUILDING: 'primary',
  READY: 'success',
  FAILED: 'danger',
};

/**
 * Imitation styles (docs/64): pages of other brands that AI studies to write a style guide
 * adapted to this business. A project picks a built and confirmed style for its drafts.
 */
export function StylesPanel({ businessId }: { businessId: string }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const { data: styles, isLoading } = useStyles(businessId);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const full = (styles?.length ?? 0) >= BUSINESS_STYLE_LIMIT;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Wand2 className="size-4" />
            {t('businesses.styles.title')}
          </span>
        }
        description={t('businesses.styles.hint')}
        descriptionAsTip
        actions={
          canEdit && (
            <Button size="sm" icon={<Plus />} disabled={full} onClick={() => setCreating(true)}>
              {t('businesses.styles.new')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !styles?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('businesses.styles.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {styles.map((s) => (
              <StyleRow
                key={s.id}
                businessId={businessId}
                style={s}
                open={openId === s.id}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              />
            ))}
          </ul>
        )}
      </CardBody>
      {creating && (
        <CreateStyleDialog
          businessId={businessId}
          onOpenChange={setCreating}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </Card>
  );
}

function StyleRow({
  businessId,
  style,
  open,
  onToggle,
}: {
  businessId: string;
  style: BusinessStyleSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const building = style.buildState === 'BUILDING';
  useTrackJob(building ? style.lastJobId : null, {
    invalidate: [styleKeys.list(businessId), styleKeys.one(style.id)],
  });
  return (
    <li className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-start hover:bg-muted/40"
      >
        <span className="min-w-0 space-y-1">
          <span className="block truncate font-semibold" dir="auto">
            {style.name}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t('businesses.styles.sourcesCount', { count: formatNumber(style.sourceCount) })}
            {style.topicCount > 0 &&
              ` · ${t('businesses.styles.topicsCount', { count: formatNumber(style.topicCount) })}`}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[style.buildState]} dot>
            {t(`businesses.styles.state.${style.buildState}`)}
          </Badge>
          {style.buildState === 'READY' && (
            <Badge tone={style.reviewedAt ? 'success' : 'warning'}>
              {style.reviewedAt
                ? t('businesses.styles.reviewed')
                : t('businesses.styles.unreviewed')}
            </Badge>
          )}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && <StyleDetail businessId={businessId} id={style.id} />}
    </li>
  );
}

function StyleDetail({ businessId, id }: { businessId: string; id: string }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const { data: style, isLoading } = useStyle(id);
  const build = useBuildStyle(businessId, id);
  const review = useReviewStyle(businessId, id);
  const remove = useDeleteStyle(businessId);
  const [editing, setEditing] = useState<'meta' | 'guide' | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<StyleSourceSummary | null>(null);

  if (isLoading || !style) {
    return (
      <div className="flex justify-center border-t py-8">
        <Spinner />
      </div>
    );
  }

  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const building = style.buildState === 'BUILDING';
  const readable = style.sources.filter((s) => s.status === 'READY').length;
  const built = style.buildState === 'READY';
  const sourcesFull = style.sources.length >= STYLE_SOURCE_LIMIT;

  return (
    <div className="space-y-5 border-t px-4 py-4">
      {building && (
        <AiWorkingBanner
          title={t('businesses.styles.building')}
          hint={t('businesses.styles.buildingHint')}
        />
      )}
      {style.buildState === 'FAILED' && (
        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">{t('businesses.styles.buildFailed')}</p>
            {style.buildError && (
              <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                {style.buildError}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm leading-7 text-muted-foreground" dir="auto">
          {style.direction || t('businesses.styles.directionHint')}
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<Pencil />}
              onClick={() => setEditing('meta')}
            >
              {t('common.edit')}
            </Button>
            <ConfirmationDialog
              trigger={
                <Button size="icon" variant="ghost" aria-label={t('common.delete')}>
                  <Trash2 />
                </Button>
              }
              body={t('businesses.styles.deleteBody')}
              isLoading={remove.isPending}
              onConfirm={() =>
                remove.mutateAsync(id).then(() => notify.success(t('businesses.styles.deleted')))
              }
            />
          </div>
        )}
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{t('businesses.styles.sources')}</h4>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              icon={<Plus />}
              disabled={sourcesFull}
              onClick={() => setAdding(true)}
            >
              {t('businesses.styles.addSource')}
            </Button>
          )}
        </div>
        {!style.sources.length ? (
          <p className="text-sm text-muted-foreground">{t('businesses.styles.noSources')}</p>
        ) : (
          <ul className="space-y-2">
            {style.sources.map((s) => (
              <SourceRow
                key={s.id}
                businessId={businessId}
                source={s}
                canEdit={canEdit}
                onView={() => setViewing(s)}
              />
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          {built ? (
            <ConfirmationDialog
              tone="default"
              trigger={
                <Button
                  variant="outline"
                  icon={<Sparkles />}
                  disabled={building || !readable}
                  isLoading={build.isPending}
                >
                  {t('businesses.styles.rebuild')}
                </Button>
              }
              body={t('businesses.styles.rebuildWarn')}
              onConfirm={() =>
                build.mutateAsync().then(() => notify.info(t('businesses.styles.buildQueued')), onError)
              }
            />
          ) : (
            <Button
              icon={<Sparkles />}
              disabled={building || !readable}
              isLoading={build.isPending}
              onClick={() =>
                build.mutate(undefined, {
                  onSuccess: () => notify.info(t('businesses.styles.buildQueued')),
                  onError,
                })
              }
            >
              {t('businesses.styles.build')}
            </Button>
          )}
          {!readable && (
            <span className="text-xs text-muted-foreground">
              {t('businesses.styles.buildNeedsSource')}
            </span>
          )}
        </div>
      )}

      {built && (
        <BuiltStyle
          style={style}
          canEdit={canEdit}
          reviewing={review.isPending}
          onEditGuide={() => setEditing('guide')}
          onReview={() => review.mutate(undefined, { onError })}
        />
      )}

      {editing && (
        <EditStyleDialog
          businessId={businessId}
          style={style}
          mode={editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
      {adding && (
        <AddSourceDialog businessId={businessId} styleId={id} onOpenChange={setAdding} />
      )}
      {viewing && <SourceTextDialog source={viewing} onOpenChange={() => setViewing(null)} />}
    </div>
  );
}

function BuiltStyle({
  style,
  canEdit,
  reviewing,
  onEditGuide,
  onReview,
}: {
  style: BusinessStyleDetail;
  canEdit: boolean;
  reviewing: boolean;
  onEditGuide: () => void;
  onReview: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
          style.reviewedAt ? 'border-success/30 bg-success/5' : 'border-warning/40 bg-warning/10',
        )}
      >
        <span>
          {style.reviewedAt ? t('businesses.styles.confirmed') : t('businesses.styles.needsConfirm')}
          {style.builtAt && (
            <span className="ms-2 text-xs text-muted-foreground">{formatDate(style.builtAt)}</span>
          )}
        </span>
        {canEdit && !style.reviewedAt && (
          <Button size="sm" icon={<Check />} isLoading={reviewing} onClick={onReview}>
            {t('businesses.styles.confirm')}
          </Button>
        )}
      </div>

      <section className="space-y-1">
        <h4 className="text-sm font-semibold">{t('businesses.styles.summary')}</h4>
        <p className="text-sm leading-7" dir="auto">
          {style.summary}
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{t('businesses.styles.traits')}</h4>
        <ul className="grid gap-2 sm:grid-cols-2">
          {style.traits.map((trait, i) => (
            <li key={i} className="space-y-1 rounded-lg border p-3 text-sm">
              <Badge tone="outline">{t(`enums.styleTrait.${trait.category}`)}</Badge>
              <p className="font-medium" dir="auto">
                {trait.name}
              </p>
              <p className="text-xs leading-6 text-muted-foreground" dir="auto">
                {trait.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{t('businesses.styles.guide')}</h4>
          {canEdit && (
            <Button size="sm" variant="outline" icon={<Pencil />} onClick={onEditGuide}>
              {t('businesses.styles.editGuide')}
            </Button>
          )}
        </div>
        <pre
          dir="auto"
          className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm leading-7"
        >
          {style.guide}
        </pre>
        <p className="text-xs text-muted-foreground">{t('businesses.styles.rules')}</p>
      </section>

      {style.caveats.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-semibold">{t('businesses.styles.caveats')}</h4>
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
            {style.caveats.map((c, i) => (
              <li key={i} dir="auto">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SourceRow({
  businessId,
  source,
  canEdit,
  onView,
}: {
  businessId: string;
  source: StyleSourceSummary;
  canEdit: boolean;
  onView: () => void;
}) {
  const t = useT();
  const refresh = useRefreshStyleSource(businessId);
  const remove = useDeleteStyleSource(businessId);
  const Icon = KIND_ICON[source.kind];
  // text and hand-typed Instagram data have nothing to read again
  const manual = (source.analysis as { provider?: string } | null | undefined)?.provider === 'MANUAL';
  const canRefresh = canEdit && source.kind !== 'TEXT' && !manual;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" dir="auto">
            {source.title || source.url || t(`enums.styleSourceKind.${source.kind}`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`enums.styleSourceKind.${source.kind}`)}
            {source.status === 'READY' && ` · ${formatNumber(source.chars)}`}
            {source.fetchedAt && ` · ${formatDate(source.fetchedAt)}`}
          </p>
          {source.status === 'FAILED' && source.error && (
            <p className="text-xs text-destructive" dir="auto">
              {source.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('businesses.styles.viewText')}
          disabled={source.status !== 'READY'}
          onClick={onView}
        >
          <Eye />
        </Button>
        {canRefresh && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('common.refresh')}
            isLoading={refresh.isPending}
            onClick={() =>
              refresh.mutate(source.id, {
                onSuccess: () => notify.success(t('businesses.styles.refreshed')),
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            <RefreshCw />
          </Button>
        )}
        {canEdit && (
          <ConfirmationDialog
            trigger={
              <Button size="icon" variant="ghost" aria-label={t('common.delete')}>
                <Trash2 />
              </Button>
            }
            body={t('businesses.styles.removeSourceBody')}
            isLoading={remove.isPending}
            onConfirm={() =>
              remove.mutateAsync(source.id).then(() => notify.success(t('businesses.styles.sourceRemoved')))
            }
          />
        )}
      </div>
    </li>
  );
}

/** The stored snapshot of a source — exactly what AI reads. Mounted only while open. */
function SourceTextDialog({
  source,
  onOpenChange,
}: {
  source: StyleSourceSummary;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const { data, isLoading } = useStyleSourceText(source.id);
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.styles.viewText')}
      description={source.title || source.url}
      className="max-w-3xl"
    >
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <pre
          dir="auto"
          className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs leading-6"
        >
          {data.content}
        </pre>
      )}
    </Dialog>
  );
}

/** Name and direction of a new style. Mounted only while open. */
function CreateStyleDialog({
  businessId,
  onOpenChange,
  onCreated,
}: {
  businessId: string;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const create = useCreateStyle(businessId);
  const [name, setName] = useState('');
  const [direction, setDirection] = useState('');
  const submit = () =>
    create.mutate(
      { name: name.trim(), direction: direction.trim() },
      {
        onSuccess: (created) => {
          notify.success(t('businesses.styles.created'));
          onCreated(created.id);
          onOpenChange(false);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.styles.newTitle')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!name.trim()} isLoading={create.isPending} onClick={submit}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('businesses.styles.nameLabel')} hint={t('businesses.styles.nameHint')}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.styles.directionLabel')}
          hint={t('businesses.styles.directionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={1000}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Rename / change the direction, or edit the built guide (which confirms it). Mounted only while open. */
function EditStyleDialog({
  businessId,
  style,
  mode,
  onOpenChange,
}: {
  businessId: string;
  style: BusinessStyleDetail;
  mode: 'meta' | 'guide';
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateStyle(businessId, style.id);
  const [name, setName] = useState(style.name);
  const [direction, setDirection] = useState(style.direction);
  const [summary, setSummary] = useState(style.summary);
  const [guide, setGuide] = useState(style.guide);
  const valid = mode === 'meta' ? !!name.trim() : !!guide.trim() && !!summary.trim();
  const submit = () =>
    update.mutate(
      mode === 'meta'
        ? { name: name.trim(), direction: direction.trim() }
        : { summary: summary.trim(), guide: guide.trim() },
      {
        onSuccess: () => {
          notify.success(t('businesses.styles.saved'));
          onOpenChange(false);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={mode === 'meta' ? t('common.edit') : t('businesses.styles.editGuide')}
      className={mode === 'guide' ? 'max-w-2xl' : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} isLoading={update.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {mode === 'meta' ? (
        <div className="space-y-4">
          <Field label={t('businesses.styles.nameLabel')}>
            {(id) => (
              <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field
            label={t('businesses.styles.directionLabel')}
            hint={t('businesses.styles.directionHint')}
            optional={t('common.optional')}
          >
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={1000}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              />
            )}
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('businesses.styles.summary')}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={1200}
                dir="auto"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('businesses.styles.guide')} hint={t('businesses.styles.guideHint')}>
            {(id) => (
              <Textarea
                id={id}
                rows={12}
                maxLength={STYLE_GUIDE_MAX_CHARS}
                dir="auto"
                value={guide}
                onChange={(e) => setGuide(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/** One source of another brand: a page, a whole site, an Instagram account or a text. Mounted only while open. */
function AddSourceDialog({
  businessId,
  styleId,
  onOpenChange,
}: {
  businessId: string;
  styleId: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const add = useAddStyleSource(businessId, styleId);
  const { data: igStatus } = useInstagramStatus();
  const [tab, setTab] = useState<'link' | 'site' | 'instagram' | 'text'>('link');
  const [url, setUrl] = useState('');
  const [handleText, setHandleText] = useState('');
  const [byHand, setByHand] = useState(false);
  const [manual, setManual] = useState<ManualInstagramState>(EMPTY_MANUAL);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  const links = splitLinks(url);
  const oneLink = links.links.length === 1 && !links.invalid.length;
  const handle = parseInstagramHandle(handleText);
  const graph = igStatus?.graphConfigured ?? false;
  const showManual = !graph || byHand;
  const manualInput = showManual ? toManualInput(handle ?? '', manual) : undefined;
  const valid =
    tab === 'instagram'
      ? (!!handle && graph && !manualInput) || !!manualInput
      : tab === 'text'
        ? text.trim().length > 0
        : oneLink;

  const submit = () => {
    const input =
      tab === 'link'
        ? { url: links.links[0]! }
        : tab === 'site'
          ? { url: links.links[0]!, site: true }
          : tab === 'instagram'
            ? manualInput
              ? { instagram: manualInput }
              : { url: instagramProfileUrl(handle!) }
            : { content: text.trim(), title: title.trim() };
    add.mutate(input, {
      onSuccess: (source) => {
        if (source.status === 'FAILED') notify.warning(t('businesses.styles.sourceUnread'));
        else notify.success(t('businesses.styles.sourceAdded'));
        onOpenChange(false);
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.styles.addSourceTitle')}
      description={t('businesses.styles.addSourceSubtitle')}
      descriptionAsTip
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button icon={<Plus />} disabled={!valid} isLoading={add.isPending} onClick={submit}>
            {t('businesses.styles.addSource')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'link', label: t('businesses.styles.tabLink') },
            { value: 'site', label: t('businesses.styles.tabSite') },
            { value: 'instagram', label: t('businesses.styles.tabInstagram') },
            { value: 'text', label: t('businesses.styles.tabText') },
          ]}
        />
        {tab === 'link' || tab === 'site' ? (
          <Field
            label={tab === 'site' ? t('businesses.references.siteUrl') : t('businesses.references.url')}
            hint={tab === 'site' ? t('businesses.references.siteHint') : undefined}
            error={
              links.invalid.length
                ? t('businesses.fromSources.invalidLinks', {
                    lines: links.invalid.slice(0, 3).join(' , '),
                  })
                : undefined
            }
          >
            {(id) => (
              <Input
                id={id}
                autoFocus
                dir="ltr"
                placeholder="https://brand.ir"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
        ) : tab === 'instagram' ? (
          <>
            <Field
              label={t('businesses.references.instagramUrl')}
              hint={t('businesses.references.instagramHint')}
              error={
                handleText.trim() && !handle ? t('businesses.presence.invalidInstagram') : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  dir="ltr"
                  placeholder="@brand"
                  value={handleText}
                  onChange={(e) => setHandleText(e.target.value)}
                />
              )}
            </Field>
            <p className="text-xs leading-6 text-muted-foreground">
              {graph ? t('businesses.presence.graphOn') : t('businesses.presence.graphOff')}
            </p>
            {graph && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={byHand} onCheckedChange={setByHand} />
                {t('businesses.references.instagramManualToggle')}
              </label>
            )}
            {showManual && <InstagramManualFields value={manual} onChange={setManual} />}
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
            <Field label={t('businesses.references.text')} hint={t('businesses.references.textHint')}>
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
