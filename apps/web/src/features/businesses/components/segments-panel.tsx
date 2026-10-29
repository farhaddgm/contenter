import { useState } from 'react';
import { Check, Pencil, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import {
  BUSINESS_SEGMENT_LIMIT,
  SEGMENT_POINTS_MAX,
  SegmentKind,
  type BusinessSegment,
  type CreateBusinessSegmentInput,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { notify } from '@/stores/notifications';
import { formatNumber } from '@/utils/format';
import { useCanEditBusiness } from '../api/businesses';
import {
  segmentKeys,
  useConfirmSegment,
  useCreateSegment,
  useDeleteSegment,
  useProposeSegments,
  useSegments,
  useUpdateSegment,
} from '../api/segments';

/**
 * The audiences of a business (docs/73): market segments and personas, typed by the admin. They are
 * linked to offerings in the offering form; no prompt or export reads them yet.
 */
export function SegmentsPanel({ businessId }: { businessId: string }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const { data: rows, isLoading } = useSegments(businessId);
  const [editing, setEditing] = useState<BusinessSegment | 'new' | null>(null);
  const full = (rows?.length ?? 0) >= BUSINESS_SEGMENT_LIMIT;
  const propose = useProposeSegments(businessId);
  const [jobId, setJobId] = useState<string | null>(null);
  const tracker = useTrackJob(jobId, {
    invalidate: [segmentKeys.list(businessId)],
    onDone: () => setJobId(null),
  });
  const running = tracker.isRunning && !!jobId;
  // AI proposals wait apart from the audiences in use
  const pending = (rows ?? []).filter((s) => !s.verified);
  const confirmed = (rows ?? []).filter((s) => s.verified);
  const ask = () =>
    propose.mutate(undefined, {
      onSuccess: (r) => {
        setJobId(r.jobId);
        notify.success(t('businesses.segments.queued'));
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="size-4" />
            {t('businesses.segments.title')}
          </span>
        }
        description={t('businesses.segments.hint')}
        descriptionAsTip
        actions={
          canEdit && (
            <>
              <Button size="sm" icon={<Plus />} disabled={full} onClick={() => setEditing('new')}>
                {t('businesses.segments.new')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<Sparkles />}
                disabled={full || running}
                isLoading={propose.isPending}
                onClick={ask}
              >
                {t('businesses.segments.propose')}
              </Button>
            </>
          )
        }
      />
      <CardBody className="space-y-3">
        {running && (
          <AiWorkingBanner
            title={t('businesses.segments.proposing')}
            hint={t('businesses.segments.proposingHint')}
          />
        )}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !rows?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('businesses.segments.empty')}
          </p>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold">{t('businesses.segments.pendingTitle')}</h3>
                  <p className="text-xs text-muted-foreground">{t('businesses.segments.pendingHint')}</p>
                </div>
                <ul className="space-y-2">
                  {pending.map((s) => (
                    <SegmentRow
                      key={s.id}
                      businessId={businessId}
                      segment={s}
                      canEdit={canEdit}
                      onEdit={() => setEditing(s)}
                    />
                  ))}
                </ul>
              </section>
            )}
            {confirmed.length > 0 && (
              <ul className="space-y-2">
                {confirmed.map((s) => (
                  <SegmentRow
                    key={s.id}
                    businessId={businessId}
                    segment={s}
                    canEdit={canEdit}
                    onEdit={() => setEditing(s)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          {t('businesses.segments.limit', { count: formatNumber(BUSINESS_SEGMENT_LIMIT) })}
        </p>
      </CardBody>
      {editing && (
        <SegmentDrawer
          businessId={businessId}
          segment={editing === 'new' ? null : editing}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </Card>
  );
}

function SegmentRow({
  businessId,
  segment: s,
  canEdit,
  onEdit,
}: {
  businessId: string;
  segment: BusinessSegment;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const remove = useDeleteSegment(businessId);
  const toggle = useUpdateSegment(businessId, s.id);
  const confirm = useConfirmSegment(businessId);
  return (
    <li className="rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold" data-bidi="">
            {s.name}
            <Badge tone={s.kind === 'MARKET' ? 'primary' : 'outline'}>{t(`enums.segmentKind.${s.kind}`)}</Badge>
            {s.source === 'AI' && <Badge tone="neutral">{t('businesses.segments.ai')}</Badge>}
            {s.offeringIds.length > 0 ? (
              <Badge tone="neutral">
                {t('businesses.segments.linked', { count: formatNumber(s.offeringIds.length) })}
              </Badge>
            ) : (
              <Badge tone="warning">{t('businesses.segments.notLinked')}</Badge>
            )}
          </p>
          {s.summary && (
            <p className="text-xs leading-6 text-muted-foreground" data-bidi="">
              {s.summary}
            </p>
          )}
          {s.messageAngle && (
            <p className="text-xs leading-6" data-bidi="">
              <span className="font-semibold">{t('businesses.segments.fields.messageAngle')}: </span>
              {s.messageAngle}
            </p>
          )}
          {!s.verified && s.evidence && (
            <blockquote className="border-s-2 ps-3 text-xs leading-6 text-muted-foreground" data-bidi="">
              <span className="font-semibold">{t('businesses.segments.evidence')}: </span>
              {s.evidence}
            </blockquote>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {s.verified ? (
              <Switch
                checked={s.isActive}
                label={t('businesses.offerings.fields.active')}
                onCheckedChange={(isActive) =>
                  toggle.mutate({ isActive }, { onError: (e) => notify.error(t('common.error'), e.message) })
                }
              />
            ) : (
              <Button
                size="sm"
                icon={<Check />}
                isLoading={confirm.isPending}
                onClick={() =>
                  confirm.mutate(s.id, {
                    onSuccess: () => notify.success(t('businesses.segments.confirmed')),
                    onError: (e) => notify.error(t('common.error'), e.message),
                  })
                }
              >
                {t('businesses.segments.confirm')}
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
              body={t('businesses.segments.deleteBody')}
              isLoading={remove.isPending}
              onConfirm={() =>
                remove.mutateAsync(s.id).then(() => notify.success(t('businesses.segments.deleted')))
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
  kind: string;
  name: string;
  summary: string;
  goals: string;
  pains: string;
  objections: string;
  channels: string;
  messageAngle: string;
  note: string;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const toForm = (s: BusinessSegment | null): FormState => ({
  kind: s?.kind ?? 'PERSONA',
  name: s?.name ?? '',
  summary: s?.summary ?? '',
  goals: s?.goals.join('\n') ?? '',
  pains: s?.pains.join('\n') ?? '',
  objections: s?.objections.join('\n') ?? '',
  channels: s?.channels.join('\n') ?? '',
  messageAngle: s?.messageAngle ?? '',
  note: s?.note ?? '',
});

const toInput = (f: FormState): CreateBusinessSegmentInput => ({
  kind: f.kind as (typeof SegmentKind)[number],
  name: f.name,
  summary: f.summary,
  goals: lines(f.goals),
  pains: lines(f.pains),
  objections: lines(f.objections),
  channels: lines(f.channels),
  messageAngle: f.messageAngle,
  note: f.note,
});

function SegmentDrawer({
  businessId,
  segment,
  onOpenChange,
}: {
  businessId: string;
  segment: BusinessSegment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const create = useCreateSegment(businessId);
  const update = useUpdateSegment(businessId, segment?.id ?? '');
  const [f, setF] = useState<FormState>(() => toForm(segment));
  const [nameError, setNameError] = useState<string>();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));
  const pending = create.isPending || update.isPending;
  const count = formatNumber(SEGMENT_POINTS_MAX);

  const submit = () => {
    if (!f.name.trim()) return setNameError(t('businesses.segments.errors.name'));
    setNameError(undefined);
    const options = {
      onSuccess: () => {
        notify.success(t(segment ? 'businesses.segments.saved' : 'businesses.segments.created'));
        onOpenChange(false);
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (segment) update.mutate(toInput(f), options);
    else create.mutate(toInput(f), options);
  };

  const list = (key: 'goals' | 'pains' | 'objections' | 'channels', hint?: string) => (
    <Field
      label={t(`businesses.segments.fields.${key}`)}
      hint={hint ?? t('businesses.segments.fields.pointsHint', { count })}
    >
      {(id) => (
        <Textarea
          id={id}
          data-bidi=""
          rows={3}
          value={f[key]}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Drawer
      open
      onOpenChange={onOpenChange}
      title={t(segment ? 'businesses.segments.editTitle' : 'businesses.segments.new')}
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('businesses.segments.fields.kind')}>
            {(id) => (
              <Select
                id={id}
                value={f.kind}
                onChange={(e) => set('kind', e.target.value)}
                options={SegmentKind.map((v) => ({ value: v, label: t(`enums.segmentKind.${v}`) }))}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('businesses.segments.fields.name')} error={nameError}>
              {(id) => (
                <Input
                  id={id}
                  data-bidi=""
                  maxLength={120}
                  value={f.name}
                  aria-invalid={!!nameError}
                  onChange={(e) => set('name', e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
        <Field
          label={t('businesses.segments.fields.summary')}
          hint={t('businesses.segments.fields.summaryHint')}
        >
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
        {list('goals')}
        {list('pains')}
        {list('objections')}
        {list('channels', t('businesses.segments.fields.channelsHint', { count }))}
        <Field label={t('businesses.segments.fields.messageAngle')}>
          {(id) => (
            <Textarea
              id={id}
              data-bidi=""
              rows={2}
              maxLength={400}
              value={f.messageAngle}
              onChange={(e) => set('messageAngle', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('businesses.segments.fields.note')}
          hint={t('businesses.segments.fields.noteHint')}
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
