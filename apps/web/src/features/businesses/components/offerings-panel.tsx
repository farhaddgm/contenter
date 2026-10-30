import { useState } from 'react';
import { Check, CornerDownRight, Package, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  BUSINESS_OFFERING_LIMIT,
  OfferingKind,
  OfferingPriceAmount,
  OfferingStatus,
  OfferingStock,
  OFFERING_ALTERNATIVES_MAX,
  OFFERING_CLAIMS_MAX,
  OFFERING_NOT_FOR_MAX,
  OFFERING_GUARDRAILS_MAX,
  OFFERING_RELATED_MAX,
  OFFERING_PUSH_MAX,
  OFFERING_SEGMENTS_MAX,
  PriceCurrency,
  AlternativeKind as AlternativeKinds,
  normalizeDigits,
  hasValidPrice,
  isOfferingAvailable,
  isPeakNow,
  offeringParentProblem,
  orderOfferingTree,
  peakingSoon,
  priceText,
  staleAlternatives,
  unprovenClaims,
  type AlternativeKind,
  type BusinessOffering,
  type BusinessSegment,
  type OfferingAlternative,
  type OfferingClaim,
  type OfferingSegmentLink,
  type CreateBusinessOfferingInput,
} from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT, type TFn } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { useCanEditBusiness } from '../api/businesses';
import {
  offeringKeys,
  useConfirmOffering,
  useCreateOffering,
  useDeleteOffering,
  useExtractOfferings,
  useOfferings,
  useSetOfferingSegments,
  useUpdateOffering,
} from '../api/offerings';
import { useSegments } from '../api/segments';

/** Push level (0–3) → the key of its label. */
const PUSH_KEY = ['none', 'normal', 'priority', 'hero'] as const;

const STATUS_TONE: Record<BusinessOffering['status'], BadgeTone> = {
  ACTIVE: 'success',
  SEASONAL: 'primary',
  PAUSED: 'warning',
  DISCONTINUED: 'neutral',
};

/** "۱۹۹٬۰۰۰ تومان / ماهانه" in the UI language, or the "no price" label. */
export function priceLabel(t: TFn, o: BusinessOffering): string {
  const amount = priceText(o.priceAmount);
  if (!amount || !o.priceCurrency) return t('businesses.offerings.noPrice');
  const price = `${formatNumber(Number(amount), 2)} ${t(`enums.priceCurrency.${o.priceCurrency}`)}${
    o.priceUnit ? ` / ${o.priceUnit}` : ''
  }`;
  return o.priceFrom ? t('businesses.offerings.priceFrom', { price }) : price;
}

/**
 * The catalog (docs/67): what the business sells, with price and status. AI proposals wait for the
 * admin's confirmation and are not used anywhere until then.
 */
export function OfferingsPanel({ businessId }: { businessId: string }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const { data: rows, isLoading } = useOfferings(businessId);
  const extract = useExtractOfferings(businessId);
  const [jobId, setJobId] = useState<string | null>(null);
  const tracker = useTrackJob(jobId, {
    invalidate: [offeringKeys.list(businessId)],
    onDone: () => setJobId(null),
  });
  /** The row being edited, or a new one (optionally a variant of `parentId`). */
  const [editing, setEditing] = useState<{ offering: BusinessOffering | null; parentId?: string } | null>(null);
  const { data: segments } = useSegments(businessId);

  const pending = (rows ?? []).filter((o) => !o.verified);
  const confirmed = (rows ?? []).filter((o) => o.verified);
  const placed = orderOfferingTree(confirmed);
  const nameOf = new Map((rows ?? []).map((o) => [o.id, o.name]));
  const segmentName = new Map((segments ?? []).map((s) => [s.id, s.name]));
  const full = (rows?.length ?? 0) >= BUSINESS_OFFERING_LIMIT;
  const running = tracker.isRunning && !!jobId;
  const soon = peakingSoon(confirmed.filter((o) => o.isActive));

  const propose = (parentId?: string) =>
    extract.mutate(parentId ? { parentId } : undefined, {
      onSuccess: (r) => {
        setJobId(r.jobId);
        notify.success(t(parentId ? 'businesses.offerings.variantsQueued' : 'businesses.offerings.queued'));
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Package className="size-4" />
            {t('businesses.offerings.title')}
          </span>
        }
        description={t('businesses.offerings.hint')}
        descriptionAsTip
        actions={
          canEdit && (
            <>
              <Button size="sm" icon={<Plus />} disabled={full} onClick={() => setEditing({ offering: null })}>
                {t('businesses.offerings.new')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<Sparkles />}
                disabled={full || running}
                isLoading={extract.isPending}
                onClick={() => propose()}
              >
                {t('businesses.offerings.extract')}
              </Button>
            </>
          )
        }
      />
      <CardBody className="space-y-5">
        {running && (
          <AiWorkingBanner
            title={t('businesses.offerings.extracting')}
            hint={t('businesses.offerings.extractingHint')}
          />
        )}
        {soon.length > 0 && (
          <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm" dir="auto">
            {t('businesses.offerings.peakSoon', { names: soon.map((o) => o.name).join('، ') })}
          </p>
        )}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !rows?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('businesses.offerings.empty')}
          </p>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold">{t('businesses.offerings.pendingTitle')}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t('businesses.offerings.pendingHint')}
                  </p>
                </div>
                <ul className="space-y-2">
                  {pending.map((o) => (
                    <OfferingRow
                      key={o.id}
                      businessId={businessId}
                      offering={o}
                      canEdit={canEdit}
                      onEdit={() => setEditing({ offering: o })}
                    />
                  ))}
                </ul>
              </section>
            )}
            {confirmed.length > 0 && (
              <ul className="space-y-2">
                {placed.map(({ row: o, depth }) => (
                  <OfferingRow
                    key={o.id}
                    businessId={businessId}
                    offering={o}
                    depth={depth}
                    parentName={o.parentId ? nameOf.get(o.parentId) : undefined}
                    audiences={o.segments.map((l) => segmentName.get(l.segmentId)).filter((n): n is string => !!n)}
                    canEdit={canEdit}
                    canAddVariant={!full && offeringParentProblem({ parentId: o.id, rows: confirmed }) === null}
                    onAddVariant={() => setEditing({ offering: null, parentId: o.id })}
                    onProposeVariants={running ? undefined : () => propose(o.id)}
                    onEdit={() => setEditing({ offering: o })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {t('businesses.offerings.limit', { count: formatNumber(BUSINESS_OFFERING_LIMIT) })}
        </p>
      </CardBody>
      {editing && (
        <OfferingDrawer
          businessId={businessId}
          offering={editing.offering}
          presetParentId={editing.parentId}
          all={rows ?? []}
          others={(rows ?? []).filter((o) => o.id !== editing.offering?.id)}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </Card>
  );
}

/** Indent of a variant under its line (logical, so it follows RTL). */
const DEPTH_INDENT = ['', 'ms-6', 'ms-12'] as const;

function OfferingRow({
  businessId,
  offering: o,
  depth = 0,
  parentName,
  audiences = [],
  canEdit,
  canAddVariant = false,
  onAddVariant,
  onProposeVariants,
  onEdit,
}: {
  businessId: string;
  offering: BusinessOffering;
  /** 0 = a line or a lone offering; 1–2 = variants (docs/73). */
  depth?: number;
  parentName?: string;
  /** Names of the audiences the offering is linked to. */
  audiences?: string[];
  canEdit: boolean;
  canAddVariant?: boolean;
  onAddVariant?: () => void;
  /** Ask the model for the variants of this line (docs/73). */
  onProposeVariants?: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const confirm = useConfirmOffering(businessId);
  const remove = useDeleteOffering(businessId);
  const toggle = useUpdateOffering(businessId, o.id);
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const expired = !!o.priceAmount && !hasValidPrice(o);
  const sellable = isOfferingAvailable(o);

  return (
    <li className={`rounded-lg border px-4 py-3 ${DEPTH_INDENT[depth] ?? DEPTH_INDENT[2]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold" data-bidi="">
            {o.name}
            <Badge tone="outline">{t(`enums.offeringKind.${o.kind}`)}</Badge>
            <Badge tone={sellable ? STATUS_TONE[o.status] : 'warning'}>
              {t(`enums.offeringStatus.${o.status}`)}
            </Badge>
            {o.stock !== 'IN_STOCK' && (
              <Badge tone={o.stock === 'OUT' ? 'danger' : 'warning'}>{t(`enums.offeringStock.${o.stock}`)}</Badge>
            )}
            {isPeakNow(o) && <Badge tone="primary">{t('businesses.offerings.peakNow')}</Badge>}
            {o.push === 0 && <Badge tone="neutral">{t('businesses.offerings.push.none')}</Badge>}
            {o.push >= 2 && (
              <Badge tone="primary">{t(`businesses.offerings.push.${PUSH_KEY[o.push] ?? 'normal'}`)}</Badge>
            )}
          </p>
          {depth > 0 && parentName && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground" data-bidi="">
              <CornerDownRight className="size-3 rtl:-scale-x-100" />
              {t('businesses.offerings.variantOf', { name: parentName })}
            </p>
          )}
          <p className="text-sm tabular-nums">
            {priceLabel(t, o)}
            {expired && (
              <Badge tone="danger" className="ms-2">
                {t('businesses.offerings.priceExpired')}
              </Badge>
            )}
          </p>
          {(o.priceValidUntil || o.availableFrom || o.availableUntil) && (
            <p className="text-xs text-muted-foreground">
              {o.priceValidUntil &&
                t('businesses.offerings.validUntil', { date: formatDate(o.priceValidUntil, false) })}
              {(o.availableFrom || o.availableUntil) &&
                `${o.priceValidUntil ? ' · ' : ''}${t('businesses.offerings.season', {
                  from: o.availableFrom ? formatDate(o.availableFrom, false) : '—',
                  until: o.availableUntil ? formatDate(o.availableUntil, false) : '—',
                })}`}
            </p>
          )}
          {o.claims.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('businesses.offerings.claimsCount', { count: formatNumber(o.claims.length) })}
              {unprovenClaims(o.claims) > 0 && (
                <Badge tone="warning" className="ms-2">
                  {t('businesses.offerings.unproven', { count: formatNumber(unprovenClaims(o.claims)) })}
                </Badge>
              )}
            </p>
          )}
          {o.alternatives.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('businesses.offerings.alternativesCount', { count: formatNumber(o.alternatives.length) })}
              {staleAlternatives(o.alternatives) > 0 && (
                <Badge tone="warning" className="ms-2">
                  {t('businesses.offerings.alternativesStale', {
                    count: formatNumber(staleAlternatives(o.alternatives)),
                  })}
                </Badge>
              )}
            </p>
          )}
          {o.summary && (
            <p className="text-xs leading-6 text-muted-foreground" data-bidi="">
              {o.summary}
            </p>
          )}
          {(audiences.length > 0 || o.guardrails.length > 0) && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-bidi="">
              {audiences.length > 0 && (
                <span>{t('businesses.offerings.audiencesCount', { names: audiences.join('، ') })}</span>
              )}
              {o.guardrails.length > 0 && (
                <Badge tone="warning">
                  {t('businesses.offerings.guardrailsCount', { count: formatNumber(o.guardrails.length) })}
                </Badge>
              )}
            </p>
          )}
          {!o.verified && o.evidence && (
            <blockquote className="border-s-2 ps-3 text-xs leading-6 text-muted-foreground" data-bidi="">
              <span className="font-semibold">{t('businesses.offerings.evidence')}: </span>
              {o.evidence}
            </blockquote>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {o.verified ? (
              <Switch
                checked={o.isActive}
                label={t('businesses.offerings.fields.active')}
                onCheckedChange={(isActive) => toggle.mutate({ isActive }, { onError })}
              />
            ) : (
              <Button
                size="sm"
                icon={<Check />}
                isLoading={confirm.isPending}
                onClick={() =>
                  confirm.mutate(o.id, {
                    onSuccess: () => notify.success(t('businesses.offerings.confirmed')),
                    onError,
                  })
                }
              >
                {t('businesses.offerings.confirm')}
              </Button>
            )}
            {canAddVariant && onAddVariant && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('businesses.offerings.addVariant')}
                title={t('businesses.offerings.addVariant')}
                onClick={onAddVariant}
              >
                <Plus />
              </Button>
            )}
            {canAddVariant && onProposeVariants && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('businesses.offerings.proposeVariants')}
                title={t('businesses.offerings.proposeVariants')}
                onClick={onProposeVariants}
              >
                <Sparkles />
              </Button>
            )}
            <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={onEdit}>
              <Pencil />
            </Button>
            <ConfirmationDialog
              trigger={
                <Button size="icon" variant="ghost" aria-label={t('common.delete')}>
                  <Trash2 />
                </Button>
              }
              body={t('businesses.offerings.deleteBody')}
              isLoading={remove.isPending}
              onConfirm={() =>
                remove.mutateAsync(o.id).then(() => notify.success(t('businesses.offerings.deleted')))
              }
            />
          </div>
        )}
      </div>
    </li>
  );
}

// ---------- form ----------

interface FormState {
  name: string;
  aliases: string;
  kind: string;
  status: string;
  push: string;
  stock: string;
  parentId: string;
  guardrails: string;
  segments: OfferingSegmentLink[];
  peakMonths: number[];
  complementIds: string[];
  substituteIds: string[];
  summary: string;
  features: string;
  claims: string;
  alternatives: string;
  notFor: string;
  priceAmount: string;
  priceCurrency: string;
  priceFrom: boolean;
  priceUnit: string;
  priceValidUntil: string;
  availableFrom: string;
  availableUntil: string;
  url: string;
  note: string;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** One claim per line: "feature | benefit | proof" (the last two may be left out). */
const claimToLine = (c: OfferingClaim) =>
  [c.feature, c.benefit, c.proof].join(' | ').replace(/( \| )+$/, '');
function lineToClaim(line: string): OfferingClaim {
  const [feature = '', benefit = '', proof = ''] = line.split('|').map((p) => p.trim());
  return { feature, benefit, proof };
}

/**
 * One alternative per line: "name | kind | where we are better | where it is better | checked on".
 * The kind is a word of the current language (or the code); everything after the name may be left out.
 */
const kindLabels = (t: TFn): Record<AlternativeKind, string> => ({
  COMPETITOR: t('businesses.offerings.alternativeKinds.COMPETITOR'),
  DIY: t('businesses.offerings.alternativeKinds.DIY'),
  STATUS_QUO: t('businesses.offerings.alternativeKinds.STATUS_QUO'),
  OTHER: t('businesses.offerings.alternativeKinds.OTHER'),
});
const alternativeToLine = (a: OfferingAlternative, labels: Record<AlternativeKind, string>) =>
  [a.name, labels[a.kind], a.ourEdge, a.theirEdge, a.checkedOn].join(' | ').replace(/( \| )+$/, '');
function lineToAlternative(line: string, labels: Record<AlternativeKind, string>): OfferingAlternative {
  const [name = '', kindWord = '', ourEdge = '', theirEdge = '', date = ''] = line
    .split('|')
    .map((p) => p.trim());
  const kind =
    AlternativeKinds.find((k) => k === kindWord.toUpperCase() || labels[k] === kindWord) ?? 'COMPETITOR';
  const day = normalizeDigits(date);
  return { name, kind, ourEdge, theirEdge, checkedOn: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '' };
}

function toForm(o: BusinessOffering | null, labels: Record<AlternativeKind, string>, parentId = ''): FormState {
  return {
    name: o?.name ?? '',
    aliases: o?.aliases.join('\n') ?? '',
    kind: o?.kind ?? 'PRODUCT',
    status: o?.status ?? 'ACTIVE',
    push: String(o?.push ?? 1),
    stock: o?.stock ?? 'IN_STOCK',
    parentId: o ? (o.parentId ?? '') : parentId,
    guardrails: o?.guardrails.join('\n') ?? '',
    segments: o?.segments ?? [],
    peakMonths: o?.peakMonths ?? [],
    complementIds: o?.complementIds ?? [],
    substituteIds: o?.substituteIds ?? [],
    summary: o?.summary ?? '',
    features: o?.features.join('\n') ?? '',
    claims: o?.claims.map(claimToLine).join('\n') ?? '',
    alternatives: o?.alternatives.map((a) => alternativeToLine(a, labels)).join('\n') ?? '',
    notFor: o?.notFor.join('\n') ?? '',
    priceAmount: priceText(o?.priceAmount) ?? '',
    priceCurrency: o?.priceCurrency ?? 'IRT',
    priceFrom: o?.priceFrom ?? false,
    priceUnit: o?.priceUnit ?? '',
    priceValidUntil: o?.priceValidUntil ?? '',
    availableFrom: o?.availableFrom ?? '',
    availableUntil: o?.availableUntil ?? '',
    url: o?.url ?? '',
    note: o?.note ?? '',
  };
}

/** The request body; an empty price sends no currency either. */
function toInput(f: FormState, labels: Record<AlternativeKind, string>): CreateBusinessOfferingInput {
  const priced = f.priceAmount.trim() !== '';
  return {
    name: f.name,
    aliases: lines(f.aliases),
    kind: f.kind as (typeof OfferingKind)[number],
    status: f.status as (typeof OfferingStatus)[number],
    push: Number(f.push),
    stock: f.stock as (typeof OfferingStock)[number],
    parentId: f.parentId || null,
    guardrails: lines(f.guardrails),
    peakMonths: f.peakMonths,
    complementIds: f.complementIds,
    substituteIds: f.substituteIds,
    summary: f.summary,
    features: lines(f.features),
    claims: lines(f.claims).map(lineToClaim),
    alternatives: lines(f.alternatives).map((l) => lineToAlternative(l, labels)),
    notFor: lines(f.notFor),
    priceAmount: f.priceAmount,
    priceCurrency: priced ? (f.priceCurrency as (typeof PriceCurrency)[number]) : null,
    priceFrom: priced && f.priceFrom,
    priceUnit: priced ? f.priceUnit : '',
    priceValidUntil: priced ? f.priceValidUntil : '',
    availableFrom: f.availableFrom,
    availableUntil: f.availableUntil,
    url: f.url,
    note: f.note,
  };
}

type Errors = Partial<Record<'name' | 'priceAmount' | 'season', string>>;

function OfferingDrawer({
  businessId,
  offering,
  presetParentId,
  all,
  others,
  onOpenChange,
}: {
  businessId: string;
  offering: BusinessOffering | null;
  /** A new row starts as a variant of this one. */
  presetParentId?: string;
  /** Every offering of the business (the tree rule is checked against them). */
  all: BusinessOffering[];
  /** The other offerings of the business, to pick complements and substitutes from. */
  others: BusinessOffering[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const create = useCreateOffering(businessId);
  const update = useUpdateOffering(businessId, offering?.id ?? '');
  const setSegments = useSetOfferingSegments(businessId);
  const { data: segmentList } = useSegments(businessId);
  const [f, setF] = useState<FormState>(() => toForm(offering, kindLabels(t), presetParentId));
  // lines and products this row may sit under: confirmed ones that keep the tree valid
  const parents = all.filter(
    (o) =>
      o.verified &&
      o.id !== offering?.id &&
      offeringParentProblem({ id: offering?.id, parentId: o.id, rows: all }) === null,
  );
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));
  const pending = create.isPending || update.isPending || setSegments.isPending;

  const submit = async () => {
    const next: Errors = {};
    if (!f.name.trim()) next.name = t('businesses.offerings.errors.name');
    if (f.priceAmount.trim() && !OfferingPriceAmount.safeParse(f.priceAmount).success) {
      next.priceAmount = t('businesses.offerings.errors.price');
    }
    if (f.availableFrom && f.availableUntil && f.availableFrom > f.availableUntil) {
      next.season = t('businesses.offerings.errors.season');
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const saved = offering
        ? await update.mutateAsync(toInput(f, kindLabels(t)))
        : await create.mutateAsync(toInput(f, kindLabels(t)));
      if (JSON.stringify(f.segments) !== JSON.stringify(offering?.segments ?? [])) {
        await setSegments.mutateAsync({ id: saved.id, links: f.segments });
      }
      notify.success(t(offering ? 'businesses.offerings.saved' : 'businesses.offerings.created'));
      onOpenChange(false);
    } catch (e) {
      notify.error(t('common.error'), e instanceof Error ? e.message : undefined);
    }
  };

  const priced = f.priceAmount.trim() !== '';
  return (
    <Drawer
      open
      onOpenChange={onOpenChange}
      title={t(offering ? 'businesses.offerings.editTitle' : 'businesses.offerings.new')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button isLoading={pending} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('businesses.offerings.fields.name')} error={errors.name}>
          {(id) => (
            <Input
              id={id}
              data-bidi=""
              maxLength={120}
              value={f.name}
              aria-invalid={!!errors.name}
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.offerings.fields.aliases')}
          hint={t('businesses.offerings.fields.aliasesHint')}
        >
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={2}
              value={f.aliases}
              onChange={(e) => set('aliases', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.offerings.fields.parent')}
          hint={t('businesses.offerings.fields.parentHint')}
        >
          {(id) => (
            <Select
              id={id}
              value={f.parentId}
              onChange={(e) => set('parentId', e.target.value)}
              options={[
                { value: '', label: t('businesses.offerings.fields.parentNone') },
                ...parents.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('businesses.offerings.fields.kind')}>
            {(id) => (
              <Select
                id={id}
                value={f.kind}
                onChange={(e) => set('kind', e.target.value)}
                options={OfferingKind.map((v) => ({ value: v, label: t(`enums.offeringKind.${v}`) }))}
              />
            )}
          </Field>
          <Field label={t('businesses.offerings.fields.status')}>
            {(id) => (
              <Select
                id={id}
                value={f.status}
                onChange={(e) => set('status', e.target.value)}
                options={OfferingStatus.map((v) => ({
                  value: v,
                  label: t(`enums.offeringStatus.${v}`),
                }))}
              />
            )}
          </Field>
          <Field
            label={t('businesses.offerings.fields.push')}
            hint={t('businesses.offerings.fields.pushHint')}
          >
            {(id) => (
              <Select
                id={id}
                value={f.push}
                onChange={(e) => set('push', e.target.value)}
                options={Array.from({ length: OFFERING_PUSH_MAX + 1 }, (_, v) => ({
                  value: String(v),
                  label: t(`businesses.offerings.push.${PUSH_KEY[v] ?? 'normal'}`),
                }))}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t('businesses.offerings.fields.stock')}
            hint={t('businesses.offerings.fields.stockHint')}
          >
            {(id) => (
              <Select
                id={id}
                value={f.stock}
                onChange={(e) => set('stock', e.target.value)}
                options={OfferingStock.map((v) => ({ value: v, label: t(`enums.offeringStock.${v}`) }))}
              />
            )}
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('businesses.offerings.fields.peakMonths')}</legend>
          <p className="text-xs text-muted-foreground">{t('businesses.offerings.fields.peakMonthsHint')}</p>
          <div className="flex flex-wrap gap-2">
            {MONTHS.map((m) => {
              const on = f.peakMonths.includes(m);
              return (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={on ? 'default' : 'outline'}
                  aria-pressed={on}
                  onClick={() =>
                    set('peakMonths', on ? f.peakMonths.filter((x) => x !== m) : [...f.peakMonths, m].sort((a, b) => a - b))
                  }
                >
                  {t(`businesses.offerings.months.m${m}`)}
                </Button>
              );
            })}
          </div>
        </fieldset>
        {others.length > 0 && (
          <>
            <RelatedPicker
              label={t('businesses.offerings.fields.complements')}
              hint={t('businesses.offerings.fields.complementsHint')}
              options={others}
              value={f.complementIds}
              onChange={(v) => set('complementIds', v)}
            />
            <RelatedPicker
              label={t('businesses.offerings.fields.substitutes')}
              hint={t('businesses.offerings.fields.substitutesHint')}
              options={others}
              value={f.substituteIds}
              onChange={(v) => set('substituteIds', v)}
            />
          </>
        )}
        <Field label={t('businesses.offerings.fields.summary')}>
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={2}
              maxLength={400}
              value={f.summary}
              onChange={(e) => set('summary', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.offerings.fields.features')}
          hint={t('businesses.offerings.fields.featuresHint')}
        >
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={3}
              value={f.features}
              onChange={(e) => set('features', e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('businesses.offerings.fields.guardrails')}
          hint={t('businesses.offerings.fields.guardrailsHint', { count: formatNumber(OFFERING_GUARDRAILS_MAX) })}
        >
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={2}
              value={f.guardrails}
              onChange={(e) => set('guardrails', e.target.value)}
            />
          )}
        </Field>

        <SegmentPicker
          segments={segmentList ?? []}
          value={f.segments}
          onChange={(v) => set('segments', v)}
        />

        <Field
          label={t('businesses.offerings.fields.claims')}
          hint={t('businesses.offerings.fields.claimsHint', { count: formatNumber(OFFERING_CLAIMS_MAX) })}
        >
          {(id) => (
            <Textarea
              id={id}
              dir="auto"
              rows={4}
              value={f.claims}
              onChange={(e) => set('claims', e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('businesses.offerings.fields.alternatives')}
          hint={t('businesses.offerings.fields.alternativesHint', {
            count: formatNumber(OFFERING_ALTERNATIVES_MAX),
            kinds: Object.values(kindLabels(t)).join('، '),
          })}
        >
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={4}
              value={f.alternatives}
              onChange={(e) => set('alternatives', e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('businesses.offerings.fields.notFor')}
          hint={t('businesses.offerings.fields.notForHint', { count: formatNumber(OFFERING_NOT_FOR_MAX) })}
        >
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={2}
              value={f.notFor}
              onChange={(e) => set('notFor', e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('businesses.offerings.fields.priceAmount')}
            hint={t('businesses.offerings.fields.priceAmountHint')}
            error={errors.priceAmount}
          >
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="decimal"
                value={f.priceAmount}
                aria-invalid={!!errors.priceAmount}
                onChange={(e) => set('priceAmount', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('businesses.offerings.fields.priceCurrency')}
            hint={t('businesses.offerings.fields.priceCurrencyHint')}
          >
            {(id) => (
              <Select
                id={id}
                value={f.priceCurrency}
                disabled={!priced}
                onChange={(e) => set('priceCurrency', e.target.value)}
                options={PriceCurrency.map((v) => ({
                  value: v,
                  label: t(`enums.priceCurrency.${v}`),
                }))}
              />
            )}
          </Field>
          <Field
            label={t('businesses.offerings.fields.priceUnit')}
            hint={t('businesses.offerings.fields.priceUnitHint')}
          >
            {(id) => (
              <Input
                id={id}
                data-bidi=""
                maxLength={40}
                value={f.priceUnit}
                disabled={!priced}
                onChange={(e) => set('priceUnit', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('businesses.offerings.fields.priceValidUntil')}
            hint={t('businesses.offerings.fields.priceValidUntilHint')}
          >
            {(id) => (
              <Input
                id={id}
                type="date"
                dir="ltr"
                value={f.priceValidUntil}
                disabled={!priced}
                onChange={(e) => set('priceValidUntil', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Switch
          checked={priced && f.priceFrom}
          disabled={!priced}
          label={t('businesses.offerings.fields.priceFrom')}
          onCheckedChange={(v) => set('priceFrom', v)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('businesses.offerings.fields.availableFrom')} error={errors.season}>
            {(id) => (
              <Input
                id={id}
                type="date"
                dir="ltr"
                value={f.availableFrom}
                onChange={(e) => set('availableFrom', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('businesses.offerings.fields.availableUntil')}>
            {(id) => (
              <Input
                id={id}
                type="date"
                dir="ltr"
                value={f.availableUntil}
                onChange={(e) => set('availableUntil', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t('businesses.offerings.fields.url')}>
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              value={f.url}
              onChange={(e) => set('url', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.offerings.fields.note')}
          hint={t('businesses.offerings.fields.noteHint')}
        >
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={2}
              value={f.note}
              onChange={(e) => set('note', e.target.value)}
            />
          )}
        </Field>
      </div>
    </Drawer>
  );
}

/** Persian months 1–12 (Farvardin … Esfand). */
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Pick up to OFFERING_RELATED_MAX other offerings by name. */
function RelatedPicker({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options: BusinessOffering[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">
        {hint} {t('businesses.offerings.fields.relatedMax', { count: formatNumber(OFFERING_RELATED_MAX) })}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <Button
              key={o.id}
              type="button"
              size="sm"
              variant={on ? 'default' : 'outline'}
              aria-pressed={on}
              disabled={!on && value.length >= OFFERING_RELATED_MAX}
              onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            >
              {o.name}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Which audiences an offering is for, each as main or secondary (docs/73). */
function SegmentPicker({
  segments,
  value,
  onChange,
}: {
  segments: BusinessSegment[];
  value: OfferingSegmentLink[];
  onChange: (links: OfferingSegmentLink[]) => void;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('businesses.offerings.fields.audiences')}</legend>
      <p className="text-xs text-muted-foreground">
        {segments.length
          ? `${t('businesses.offerings.fields.audiencesHint')} ${t('businesses.offerings.fields.relatedMax', {
              count: formatNumber(OFFERING_SEGMENTS_MAX),
            })}`
          : t('businesses.offerings.fields.audiencesNone')}
      </p>
      <div className="flex flex-wrap gap-2">
        {segments.map((s) => {
          const link = value.find((l) => l.segmentId === s.id);
          return (
            <span key={s.id} className="inline-flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={link ? 'default' : 'outline'}
                aria-pressed={!!link}
                disabled={!link && value.length >= OFFERING_SEGMENTS_MAX}
                onClick={() =>
                  onChange(
                    link ? value.filter((l) => l.segmentId !== s.id) : [...value, { segmentId: s.id, fit: 2 }],
                  )
                }
              >
                {s.name}
              </Button>
              {link && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange(value.map((l) => (l.segmentId === s.id ? { ...l, fit: l.fit === 2 ? 1 : 2 } : l)))
                  }
                >
                  {t(link.fit === 2 ? 'businesses.offerings.fields.fitMain' : 'businesses.offerings.fields.fitSecondary')}
                </Button>
              )}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
