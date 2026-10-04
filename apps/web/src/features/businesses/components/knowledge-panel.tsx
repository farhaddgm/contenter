import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, BookA, ExternalLink, Hash, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  checkTerms,
  CreateBusinessFactSchema,
  FactCategory,
  isFactExpired,
  TermKind,
  type BusinessFact,
  type BusinessTerm,
  type CreateBusinessFactInput,
  type TermIssue,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT, type TFn } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';
import {
  useCreateFact,
  useCreateTerm,
  useDeleteFact,
  useDeleteTerm,
  useFacts,
  useTerms,
  useUpdateFact,
  useUpdateTerm,
} from '../api/profile-knowledge';
import { useCanEditBusiness } from '../api/businesses';

/** "Facts & terms" tab: key facts and the brand glossary (docs/16). */
export function KnowledgePanel({ businessId }: { businessId: string }) {
  return (
    <div className="space-y-4">
      <FactsCard businessId={businessId} />
      <TermsCard businessId={businessId} />
    </div>
  );
}

// ─────────────────────────────── facts ───────────────────────────────

function FactsCard({ businessId }: { businessId: string }) {
  const t = useT();
  const editable = useCanEditBusiness(businessId);
  const facts = useFacts(businessId);
  const update = useUpdateFact(businessId);
  const remove = useDeleteFact(businessId);
  const [editing, setEditing] = useState<BusinessFact | 'new' | null>(null);

  const groups = useMemo(
    () =>
      FactCategory.map((category) => ({
        category,
        items: (facts.data ?? []).filter((f) => f.category === category),
      })).filter((g) => g.items.length),
    [facts.data],
  );
  const onError = (e: Error) => notify.error(t('common.error'), e.message);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Hash className="size-4 text-primary" />
            {t('businesses.facts.title')}
          </span>
        }
        description={t('businesses.facts.hint')}
        actions={
          editable && (
            <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>
              {t('businesses.facts.add')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        {facts.isLoading ? (
          <Spinner />
        ) : !groups.length ? (
          <p className="text-sm leading-6 text-muted-foreground">{t('businesses.facts.empty')}</p>
        ) : (
          groups.map((g) => (
            <div key={g.category} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {t(`enums.factCategory.${g.category}`)}
              </p>
              <ul className="divide-y rounded-lg border">
                {g.items.map((f) => {
                  const expired = isFactExpired(f.validUntil);
                  return (
                    <li
                      key={f.id}
                      className={cn(
                        'flex flex-wrap items-start gap-3 px-3 py-2.5',
                        (!f.isActive || expired) && 'opacity-60',
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm" dir="auto">
                          <span className="text-muted-foreground">{f.label}: </span>
                          <span className="font-medium">{f.value}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {!f.verified && (
                            <Badge tone="warning">{t('businesses.facts.unverified')}</Badge>
                          )}
                          {f.source === 'AI' && (
                            <Badge tone="primary">{t('businesses.facts.fromAi')}</Badge>
                          )}
                          {expired && <Badge tone="danger">{t('businesses.facts.expired')}</Badge>}
                          {f.validUntil && (
                            <span>
                              {t('businesses.facts.until', {
                                date: formatDate(f.validUntil, false),
                              })}
                            </span>
                          )}
                          {f.sourceUrl && (
                            <a
                              href={f.sourceUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-0.5 text-primary hover:underline"
                            >
                              {t('businesses.facts.source')}
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                          {f.note && <span dir="auto">· {f.note}</span>}
                        </div>
                      </div>
                      {editable && (
                        <div className="flex items-center gap-1">
                          {!f.verified && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<BadgeCheck />}
                              isLoading={update.isPending && update.variables?.id === f.id}
                              onClick={() =>
                                update.mutate(
                                  { id: f.id, data: { verified: true } },
                                  {
                                    onSuccess: () => notify.success(t('businesses.facts.verified')),
                                    onError,
                                  },
                                )
                              }
                            >
                              {t('businesses.facts.verify')}
                            </Button>
                          )}
                          <Switch
                            checked={f.isActive}
                            label={<span className="sr-only">{t('businesses.facts.active')}</span>}
                            onCheckedChange={(isActive) =>
                              update.mutate({ id: f.id, data: { isActive } }, { onError })
                            }
                          />
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t('common.edit')}
                            title={t('common.edit')}
                            onClick={() => setEditing(f)}
                          >
                            <Pencil />
                          </Button>
                          <ConfirmationDialog
                            trigger={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t('common.delete')}
                              >
                                <Trash2 />
                              </Button>
                            }
                            isLoading={remove.isPending}
                            onConfirm={() => remove.mutateAsync(f.id).catch(onError)}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </CardBody>
      {editing && (
        <FactDialog
          businessId={businessId}
          fact={editing === 'new' ? undefined : editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
    </Card>
  );
}

/** Add/edit a fact. Mounted only while open. */
function FactDialog({
  businessId,
  fact,
  onOpenChange,
}: {
  businessId: string;
  fact?: BusinessFact;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateFact(businessId);
  const update = useUpdateFact(businessId);
  const form = useForm<CreateBusinessFactInput>({
    resolver: zodResolver(CreateBusinessFactSchema),
    defaultValues: {
      label: fact?.label ?? '',
      value: fact?.value ?? '',
      category: fact?.category ?? 'OFFER',
      sourceUrl: fact?.sourceUrl ?? '',
      validUntil: fact?.validUntil ? fact.validUntil.slice(0, 10) : '',
      note: fact?.note ?? '',
    },
  });
  const errors = form.formState.errors;
  const opts = {
    onSuccess: () => {
      notify.success(t('businesses.facts.saved'));
      onOpenChange(false);
    },
    onError: (e: Error) => notify.error(t('common.error'), e.message),
  };
  const onSubmit = form.handleSubmit((values) =>
    fact ? update.mutate({ id: fact.id, data: values }, opts) : create.mutate(values, opts),
  );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={fact ? t('businesses.facts.edit') : t('businesses.facts.add')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="fact-form" isLoading={create.isPending || update.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="fact-form" onSubmit={onSubmit} className="space-y-4">
        <Field
          label={t('businesses.facts.fields.label')}
          hint={t('businesses.facts.fields.labelHint')}
          error={errors.label?.message}
        >
          {(id) => <Input id={id} dir="auto" autoFocus {...form.register('label')} />}
        </Field>
        <Field label={t('businesses.facts.fields.value')} error={errors.value?.message}>
          {(id) => <Textarea id={id} dir="auto" rows={2} {...form.register('value')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('businesses.facts.fields.category')}>
            {(id) => (
              <Select
                id={id}
                options={FactCategory.map((c) => ({
                  value: c,
                  label: t(`enums.factCategory.${c}`),
                }))}
                {...form.register('category')}
              />
            )}
          </Field>
          <Field
            label={t('businesses.facts.fields.validUntil')}
            optional={t('common.optional')}
            error={errors.validUntil?.message}
          >
            {(id) => <Input id={id} type="date" dir="ltr" {...form.register('validUntil')} />}
          </Field>
        </div>
        <p className="-mt-2 text-xs leading-5 text-muted-foreground">
          {t('businesses.facts.fields.validUntilHint')}
        </p>
        <Field
          label={t('businesses.facts.fields.sourceUrl')}
          optional={t('common.optional')}
          error={errors.sourceUrl?.message}
        >
          {(id) => (
            <Input id={id} dir="ltr" placeholder="https://" {...form.register('sourceUrl')} />
          )}
        </Field>
        <Field
          label={t('businesses.facts.fields.note')}
          optional={t('common.optional')}
          error={errors.note?.message}
        >
          {(id) => <Input id={id} dir="auto" {...form.register('note')} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ─────────────────────────────── terms ───────────────────────────────

/** "a, b، c" → ['a', 'b', 'c'] (Latin and Persian commas). */
const splitList = (v: string) =>
  v
    .split(/[,،\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function TermsCard({ businessId }: { businessId: string }) {
  const t = useT();
  const editable = useCanEditBusiness(businessId);
  const terms = useTerms(businessId);
  const create = useCreateTerm(businessId);
  const update = useUpdateTerm(businessId);
  const remove = useDeleteTerm(businessId);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<TermKind>('USE');
  const [alternatives, setAlternatives] = useState('');
  const [note, setNote] = useState('');
  const [sample, setSample] = useState('');
  const onError = (e: Error) => notify.error(t('common.error'), e.message);

  const issues = useMemo(
    () => (sample.trim() && terms.data ? checkTerms(sample, terms.data) : []),
    [sample, terms.data],
  );

  const submit = () =>
    create.mutate(
      { term: term.trim(), kind, alternatives: splitList(alternatives), note: note.trim() },
      {
        onSuccess: () => {
          notify.success(t('businesses.terms.created'));
          setTerm('');
          setAlternatives('');
          setNote('');
        },
        onError,
      },
    );

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BookA className="size-4 text-primary" />
            {t('businesses.terms.title')}
          </span>
        }
        description={t('businesses.terms.hint')}
      />
      <CardBody className="space-y-4">
        {editable && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Field label={t('businesses.terms.fields.term')}>
                {(id) => (
                  <Input
                    id={id}
                    dir="auto"
                    value={term}
                    maxLength={120}
                    onChange={(e) => setTerm(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('businesses.terms.fields.kind')}>
                {(id) => (
                  <Select
                    id={id}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as TermKind)}
                    options={TermKind.map((k) => ({ value: k, label: t(`enums.termKind.${k}`) }))}
                  />
                )}
              </Field>
            </div>
            <Field
              label={t(`businesses.terms.fields.alternatives${kind}`)}
              hint={t('businesses.terms.fields.alternativesHint')}
            >
              {(id) => (
                <Input
                  id={id}
                  dir="auto"
                  value={alternatives}
                  onChange={(e) => setAlternatives(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('businesses.terms.fields.note')}>
              {(id) => (
                <Input
                  id={id}
                  dir="auto"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button
                size="sm"
                icon={<Plus />}
                disabled={!term.trim()}
                isLoading={create.isPending}
                onClick={submit}
              >
                {t('businesses.terms.add')}
              </Button>
            </div>
          </div>
        )}

        {terms.isLoading ? (
          <Spinner />
        ) : !terms.data?.length ? (
          <p className="text-sm leading-6 text-muted-foreground">{t('businesses.terms.empty')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {terms.data.map((row) => (
              <TermRow
                key={row.id}
                term={row}
                editable={editable}
                onToggle={(isActive) =>
                  update.mutate({ id: row.id, data: { isActive } }, { onError })
                }
                onDelete={() => remove.mutateAsync(row.id).catch(onError)}
                deleting={remove.isPending}
              />
            ))}
          </ul>
        )}

        {!!terms.data?.length && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {t('businesses.terms.test')}
            </p>
            <Textarea
              rows={3}
              dir="auto"
              value={sample}
              placeholder={t('businesses.terms.testPlaceholder')}
              aria-label={t('businesses.terms.test')}
              onChange={(e) => setSample(e.target.value)}
            />
            {sample.trim() &&
              (issues.length ? (
                <TermIssueList issues={issues} />
              ) : (
                <p className="text-xs text-success">{t('businesses.terms.testOk')}</p>
              ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TermRow({
  term,
  editable,
  onToggle,
  onDelete,
  deleting,
}: {
  term: BusinessTerm;
  editable: boolean;
  onToggle: (v: boolean) => void;
  onDelete: () => Promise<unknown>;
  deleting: boolean;
}) {
  const t = useT();
  const list = term.alternatives.map((a) => `«${a}»`).join('، ');
  return (
    <li
      className={cn('flex flex-wrap items-center gap-3 px-3 py-2', !term.isActive && 'opacity-60')}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={term.kind === 'USE' ? 'success' : 'danger'}>
            {t(`enums.termKind.${term.kind}`)}
          </Badge>
          <span className="font-medium" dir="auto">
            {term.term}
          </span>
        </p>
        {(list || term.note) && (
          <p className="text-xs text-muted-foreground" dir="auto">
            {list &&
              t(
                term.kind === 'USE' ? 'businesses.terms.wrongForms' : 'businesses.terms.insteadUse',
                {
                  list,
                },
              )}
            {list && term.note ? ' · ' : ''}
            {term.note}
          </p>
        )}
      </div>
      {editable && (
        <div className="flex items-center gap-1">
          <Switch checked={term.isActive} onCheckedChange={onToggle} />
          <ConfirmationDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                <Trash2 />
              </Button>
            }
            isLoading={deleting}
            onConfirm={onDelete}
          />
        </div>
      )}
    </li>
  );
}

/** Violations found by `checkTerms` (shared with the content page). */
export function TermIssueList({ issues }: { issues: TermIssue[] }) {
  const t = useT();
  return (
    <ul className="space-y-1.5 text-sm">
      {issues.map((i, n) => (
        <li key={n} className="rounded-md bg-warning/10 px-3 py-1.5 leading-6">
          {termIssueText(t, i)}
          {i.kind === 'AVOID' && i.replaceWith.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {' '}
              · {t('businesses.termIssue.replace', { list: i.replaceWith.join('، ') })}
            </span>
          )}
          {i.note && <span className="text-xs text-muted-foreground"> · {i.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function termIssueText(t: TFn, i: TermIssue) {
  return t(`businesses.termIssue.${i.kind}`, {
    found: i.found,
    term: i.term,
    count: formatNumber(i.count),
  });
}
