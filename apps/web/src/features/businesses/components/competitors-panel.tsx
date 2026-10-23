import { useState } from 'react';
import { FileInput, Pencil, Plus, Swords, Trash2 } from 'lucide-react';
import {
  BUSINESS_COMPETITOR_LIMIT,
  CompetitorKind,
  type BusinessCompetitor,
  type CreateBusinessCompetitorInput,
} from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatNumber } from '@/utils/format';
import { useCanEditBusiness } from '../api/businesses';
import {
  useAddCompetitorsToProfile,
  useCompetitors,
  useCreateCompetitor,
  useDeleteCompetitor,
  useUpdateCompetitor,
} from '../api/competitors';

const KIND_TONE: Record<BusinessCompetitor['kind'], BadgeTone> = {
  DIRECT: 'danger',
  INDIRECT: 'warning',
  REFERENCE: 'neutral',
};

/**
 * Competitor cards (docs/70, phase 1): typed by the admin, never read by a prompt on their own.
 * "Add to profile" is what puts them into the COMPETITORS section.
 */
export function CompetitorsPanel({ businessId }: { businessId: string }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const { data: rows, isLoading } = useCompetitors(businessId);
  const addToProfile = useAddCompetitorsToProfile(businessId);
  const [editing, setEditing] = useState<BusinessCompetitor | 'new' | null>(null);
  const full = (rows?.length ?? 0) >= BUSINESS_COMPETITOR_LIMIT;
  const hasActive = (rows ?? []).some((c) => c.isActive);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Swords className="size-4" />
            {t('businesses.competitors.title')}
          </span>
        }
        description={t('businesses.competitors.hint')}
        descriptionAsTip
        actions={
          canEdit && (
            <>
              <Button size="sm" icon={<Plus />} disabled={full} onClick={() => setEditing('new')}>
                {t('businesses.competitors.new')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<FileInput />}
                disabled={!hasActive}
                isLoading={addToProfile.isPending}
                onClick={() =>
                  addToProfile.mutate(undefined, {
                    onSuccess: () => notify.success(t('businesses.competitors.addedToProfile')),
                    onError: (e) => notify.error(t('common.error'), e.message),
                  })
                }
              >
                {t('businesses.competitors.addToProfile')}
              </Button>
            </>
          )
        }
      />
      <CardBody className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !rows?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('businesses.competitors.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((c) => (
              <CompetitorRow
                key={c.id}
                businessId={businessId}
                competitor={c}
                canEdit={canEdit}
                onEdit={() => setEditing(c)}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {t('businesses.competitors.limit', { count: formatNumber(BUSINESS_COMPETITOR_LIMIT) })}
        </p>
      </CardBody>
      {editing && (
        <CompetitorDrawer
          businessId={businessId}
          competitor={editing === 'new' ? null : editing}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </Card>
  );
}

function CompetitorRow({
  businessId,
  competitor: c,
  canEdit,
  onEdit,
}: {
  businessId: string;
  competitor: BusinessCompetitor;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const remove = useDeleteCompetitor(businessId);
  const toggle = useUpdateCompetitor(businessId, c.id);

  return (
    <li className="rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold" dir="auto">
            {c.name}
            <Badge tone={KIND_TONE[c.kind]}>{t(`enums.competitorKind.${c.kind}`)}</Badge>
          </p>
          {c.positioning && (
            <p className="text-sm text-muted-foreground" dir="auto">
              {c.positioning}
            </p>
          )}
          {c.pricing && (
            <p className="text-xs text-muted-foreground" dir="auto">
              {t('businesses.competitors.fields.pricing')}: {c.pricing}
            </p>
          )}
          {c.strengths.length > 0 && (
            <p className="text-xs leading-6" dir="auto">
              <span className="font-semibold">{t('businesses.competitors.fields.strengths')}: </span>
              {c.strengths.join('، ')}
            </p>
          )}
          {c.weaknesses.length > 0 && (
            <p className="text-xs leading-6" dir="auto">
              <span className="font-semibold">{t('businesses.competitors.fields.weaknesses')}: </span>
              {c.weaknesses.join('، ')}
            </p>
          )}
          {c.difference && (
            <p className="text-xs leading-6 text-muted-foreground" dir="auto">
              <span className="font-semibold">{t('businesses.competitors.fields.difference')}: </span>
              {c.difference}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={c.isActive}
              label={t('businesses.competitors.fields.active')}
              onCheckedChange={(isActive) =>
                toggle.mutate({ isActive }, { onError: (e) => notify.error(t('common.error'), e.message) })
              }
            />
            <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={onEdit}>
              <Pencil />
            </Button>
            <ConfirmationDialog
              trigger={
                <Button size="icon" variant="ghost" aria-label={t('common.delete')}>
                  <Trash2 />
                </Button>
              }
              body={t('businesses.competitors.deleteBody')}
              isLoading={remove.isPending}
              onConfirm={() =>
                remove.mutateAsync(c.id).then(() => notify.success(t('businesses.competitors.deleted')))
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
  kind: string;
  website: string;
  instagram: string;
  positioning: string;
  pricing: string;
  strengths: string;
  weaknesses: string;
  difference: string;
  note: string;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function toForm(c: BusinessCompetitor | null): FormState {
  return {
    name: c?.name ?? '',
    kind: c?.kind ?? 'DIRECT',
    website: c?.website ?? '',
    instagram: c?.instagram ?? '',
    positioning: c?.positioning ?? '',
    pricing: c?.pricing ?? '',
    strengths: c?.strengths.join('\n') ?? '',
    weaknesses: c?.weaknesses.join('\n') ?? '',
    difference: c?.difference ?? '',
    note: c?.note ?? '',
  };
}

function toInput(f: FormState): CreateBusinessCompetitorInput {
  return {
    name: f.name,
    kind: f.kind as (typeof CompetitorKind)[number],
    website: f.website,
    instagram: f.instagram,
    positioning: f.positioning,
    pricing: f.pricing,
    strengths: lines(f.strengths),
    weaknesses: lines(f.weaknesses),
    difference: f.difference,
    note: f.note,
  };
}

function CompetitorDrawer({
  businessId,
  competitor,
  onOpenChange,
}: {
  businessId: string;
  competitor: BusinessCompetitor | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const create = useCreateCompetitor(businessId);
  const update = useUpdateCompetitor(businessId, competitor?.id ?? '');
  const [f, setF] = useState<FormState>(() => toForm(competitor));
  const [nameError, setNameError] = useState<string | undefined>();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (!f.name.trim()) {
      setNameError(t('businesses.competitors.errors.name'));
      return;
    }
    setNameError(undefined);
    const options = {
      onSuccess: () => {
        notify.success(t(competitor ? 'businesses.competitors.saved' : 'businesses.competitors.created'));
        onOpenChange(false);
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (competitor) update.mutate(toInput(f), options);
    else create.mutate(toInput(f), options);
  };

  const text = (key: keyof FormState, max: number, dir: 'auto' | 'ltr' = 'auto') =>
    (id: string) => (
      <Input id={id} dir={dir} maxLength={max} value={f[key]} onChange={(e) => set(key, e.target.value)} />
    );
  const area = (key: keyof FormState, rows: number, max?: number) => (id: string) => (
    <Textarea
      id={id}
      dir="auto"
      rows={rows}
      maxLength={max}
      value={f[key]}
      onChange={(e) => set(key, e.target.value)}
    />
  );

  return (
    <Drawer
      open
      onOpenChange={onOpenChange}
      title={t(competitor ? 'businesses.competitors.editTitle' : 'businesses.competitors.new')}
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
        <Field label={t('businesses.competitors.fields.name')} error={nameError}>
          {text('name', 120)}
        </Field>
        <Field label={t('businesses.competitors.fields.kind')} hint={t('businesses.competitors.fields.kindHint')}>
          {(id) => (
            <Select
              id={id}
              value={f.kind}
              onChange={(e) => set('kind', e.target.value)}
              options={CompetitorKind.map((v) => ({ value: v, label: t(`enums.competitorKind.${v}`) }))}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('businesses.competitors.fields.website')}>{text('website', 2000, 'ltr')}</Field>
          <Field
            label={t('businesses.competitors.fields.instagram')}
            hint={t('businesses.competitors.fields.instagramHint')}
          >
            {text('instagram', 200, 'ltr')}
          </Field>
        </div>
        <Field label={t('businesses.competitors.fields.positioning')}>{area('positioning', 2, 400)}</Field>
        <Field label={t('businesses.competitors.fields.pricing')} hint={t('businesses.competitors.fields.pricingHint')}>
          {text('pricing', 200)}
        </Field>
        <Field label={t('businesses.competitors.fields.strengths')} hint={t('businesses.competitors.fields.pointsHint')}>
          {area('strengths', 3)}
        </Field>
        <Field label={t('businesses.competitors.fields.weaknesses')} hint={t('businesses.competitors.fields.pointsHint')}>
          {area('weaknesses', 3)}
        </Field>
        <Field label={t('businesses.competitors.fields.difference')} hint={t('businesses.competitors.fields.differenceHint')}>
          {area('difference', 2, 400)}
        </Field>
        <Field label={t('businesses.competitors.fields.note')} hint={t('businesses.competitors.fields.noteHint')}>
          {area('note', 2, 1000)}
        </Field>
      </div>
    </Drawer>
  );
}
