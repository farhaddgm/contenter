import { useState } from 'react';
import { Check, Package, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  BUSINESS_OFFERING_LIMIT,
  OfferingKind,
  OfferingPriceAmount,
  OfferingStatus,
  OfferingStock,
  OFFERING_CLAIMS_MAX,
  OFFERING_RELATED_MAX,
  OFFERING_PUSH_MAX,
  PriceCurrency,
  hasValidPrice,
  isOfferingAvailable,
  isPeakNow,
  peakingSoon,
  priceText,
  unprovenClaims,
  type BusinessOffering,
  type OfferingClaim,
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
  useUpdateOffering,
} from '../api/offerings';

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
  const [editing, setEditing] = useState<BusinessOffering | 'new' | null>(null);

  const pending = (rows ?? []).filter((o) => !o.verified);
  const confirmed = (rows ?? []).filter((o) => o.verified);
  const full = (rows?.length ?? 0) >= BUSINESS_OFFERING_LIMIT;
  const running = tracker.isRunning && !!jobId;
  const soon = peakingSoon(confirmed.filter((o) => o.isActive));

  const propose = () =>
    extract.mutate(undefined, {
      onSuccess: (r) => {
        setJobId(r.jobId);
        notify.success(t('businesses.offerings.queued'));
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
              <Button size="sm" icon={<Plus />} disabled={full} onClick={() => setEditing('new')}>
                {t('businesses.offerings.new')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<Sparkles />}
                disabled={full || running}
                isLoading={extract.isPending}
                onClick={propose}
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
                      onEdit={() => setEditing(o)}
                    />
                  ))}
                </ul>
              </section>
            )}
            {confirmed.length > 0 && (
              <ul className="space-y-2">
                {confirmed.map((o) => (
                  <OfferingRow
                    key={o.id}
                    businessId={businessId}
                    offering={o}
                    canEdit={canEdit}
                    onEdit={() => setEditing(o)}
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
          offering={editing === 'new' ? null : editing}
          others={(rows ?? []).filter((o) => editing === 'new' || o.id !== editing.id)}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </Card>
  );
}

function OfferingRow({
  businessId,
  offering: o,
  canEdit,
  onEdit,
}: {
  businessId: string;
  offering: BusinessOffering;
  canEdit: boolean;
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
    <li className="rounded-lg border px-4 py-3">
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
          {o.summary && (
            <p className="text-xs leading-6 text-muted-foreground" data-bidi="">
              {o.summary}
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
  peakMonths: number[];
  complementIds: string[];
  substituteIds: string[];
  summary: string;
  features: string;
  claims: string;
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

function toForm(o: BusinessOffering | null): FormState {
  return {
    name: o?.name ?? '',
    aliases: o?.aliases.join('\n') ?? '',
    kind: o?.kind ?? 'PRODUCT',
    status: o?.status ?? 'ACTIVE',
    push: String(o?.push ?? 1),
    stock: o?.stock ?? 'IN_STOCK',
    peakMonths: o?.peakMonths ?? [],
    complementIds: o?.complementIds ?? [],
    substituteIds: o?.substituteIds ?? [],
    summary: o?.summary ?? '',
    features: o?.features.join('\n') ?? '',
    claims: o?.claims.map(claimToLine).join('\n') ?? '',
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
function toInput(f: FormState): CreateBusinessOfferingInput {
  const priced = f.priceAmount.trim() !== '';
  return {
    name: f.name,
    aliases: lines(f.aliases),
    kind: f.kind as (typeof OfferingKind)[number],
    status: f.status as (typeof OfferingStatus)[number],
    push: Number(f.push),
    stock: f.stock as (typeof OfferingStock)[number],
    peakMonths: f.peakMonths,
    complementIds: f.complementIds,
    substituteIds: f.substituteIds,
    summary: f.summary,
    features: lines(f.features),
    claims: lines(f.claims).map(lineToClaim),
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
  others,
  onOpenChange,
}: {
  businessId: string;
  offering: BusinessOffering | null;
  /** The other offerings of the business, to pick complements and substitutes from. */
  others: BusinessOffering[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const create = useCreateOffering(businessId);
  const update = useUpdateOffering(businessId, offering?.id ?? '');
  const [f, setF] = useState<FormState>(() => toForm(offering));
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));
  const pending = create.isPending || update.isPending;

  const submit = () => {
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
    const options = {
      onSuccess: () => {
        notify.success(t(offering ? 'businesses.offerings.saved' : 'businesses.offerings.created'));
        onOpenChange(false);
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (offering) update.mutate(toInput(f), options);
    else create.mutate(toInput(f), options);
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
          <Button isLoading={pending} onClick={submit}>
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
