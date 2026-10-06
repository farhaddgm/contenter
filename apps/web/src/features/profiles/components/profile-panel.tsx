import { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  FilePlus2,
  Layers,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  TraitCategory,
  type ContentProfile,
  type ProfileTrait,
  type TraitStatus,
} from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { MarkdownView } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { useSamples } from '@/features/samples/api/samples';
import { useBrandDocs, useTopicAiContext } from '@/features/brand-docs/api/brand-docs';
import {
  profileKeys,
  useAddTrait,
  useApproveProfile,
  useArchiveProfile,
  useBuildProfile,
  useCreateProfile,
  useDeleteTrait,
  useDuplicateProfile,
  useProfile,
  useProfiles,
  useUpdateProfile,
  useUpdateTrait,
} from '../api/profiles';

/** How a version came to be: AI build, manual creation, or a copy of another version. */
function useOrigin() {
  const t = useT();
  return (p: Pick<ContentProfile, 'jobId' | 'basedOnVersion'>) =>
    p.jobId
      ? t('profiles.origin.AI')
      : p.basedOnVersion
        ? t('profiles.origin.COPY', { version: formatNumber(p.basedOnVersion) })
        : t('profiles.origin.MANUAL');
}

function TraitRow({
  trait,
  editable,
  onEdit,
}: {
  trait: ProfileTrait;
  editable: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const update = useUpdateTrait();
  const remove = useDeleteTrait();
  const setStatus = (status: TraitStatus) =>
    update.mutate(
      { id: trait.id, data: { status } },
      { onError: (e) => notify.error(t('common.error'), e.message) },
    );
  return (
    <li
      className={cn(
        'rounded-lg border p-3.5 transition',
        trait.status === 'REJECTED' && 'opacity-55',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{trait.name}</span>
          <Badge tone={statusTone[trait.status]}>{t(`enums.traitStatus.${trait.status}`)}</Badge>
          <Badge tone="neutral">{t(`profiles.source.${trait.source}`)}</Badge>
        </div>
        {editable && (
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant={trait.status === 'APPROVED' ? 'success' : 'outline'}
              aria-label={t('profiles.approveTrait')}
              onClick={() => setStatus(trait.status === 'APPROVED' ? 'PROPOSED' : 'APPROVED')}
            >
              <Check />
            </Button>
            <Button
              size="icon-sm"
              variant={trait.status === 'REJECTED' ? 'destructive' : 'outline'}
              aria-label={t('profiles.rejectTrait')}
              onClick={() => setStatus(trait.status === 'REJECTED' ? 'PROPOSED' : 'REJECTED')}
            >
              <X />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('profiles.editTrait')}
              onClick={onEdit}
            >
              <Pencil className="text-muted-foreground" />
            </Button>
            <ConfirmationDialog
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              }
              onConfirm={() => remove.mutateAsync(trait.id)}
            />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-7">{trait.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {t('profiles.confidence')}
          <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full bg-primary"
              style={{ width: `${Math.round(trait.confidence * 100)}%` }}
            />
          </span>
          {formatNumber(trait.confidence * 100)}٪
        </span>
        {trait.evidence && <span className="line-clamp-1">« {trait.evidence} »</span>}
      </div>
    </li>
  );
}

/** Adds a trait, or edits one when `trait` is given. Mounted only while open. */
function TraitDialog({
  profileId,
  trait,
  onOpenChange,
}: {
  profileId: string;
  trait?: ProfileTrait;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const add = useAddTrait(profileId);
  const update = useUpdateTrait();
  const [category, setCategory] = useState<(typeof TraitCategory)[number]>(
    trait?.category ?? 'TONE',
  );
  const [name, setName] = useState(trait?.name ?? '');
  const [description, setDescription] = useState(trait?.description ?? '');
  const [evidence, setEvidence] = useState(trait?.evidence ?? '');
  const opts = {
    onSuccess: () => onOpenChange(false),
    onError: (e: Error) => notify.error(t('common.error'), e.message),
  };
  const save = () => {
    const data = { category, name, description, evidence };
    if (trait) update.mutate({ id: trait.id, data }, opts);
    else add.mutate(data, opts);
  };
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={trait ? t('profiles.editTrait') : t('profiles.addTrait')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            isLoading={add.isPending || update.isPending}
            disabled={name.trim().length < 2 || description.trim().length < 2}
            onClick={save}
          >
            {trait ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('principles.kind')}>
          {(id) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              options={TraitCategory.map((c) => ({
                value: c,
                label: t(`enums.traitCategory.${c}`),
              }))}
            />
          )}
        </Field>
        <Field label={t('profiles.traitName')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('profiles.traitDescription')}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('profiles.evidence')} optional={t('common.optional')}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Summary + style guide form. With `profile` it edits that draft; without it, it creates a
 * new manual draft version for the topic. Mounted only while open.
 */
function ProfileTextDialog({
  topicId,
  profile,
  onOpenChange,
  onCreated,
}: {
  topicId: string;
  profile?: Pick<ContentProfile, 'id' | 'summary' | 'styleGuide'>;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const t = useT();
  const update = useUpdateProfile();
  const create = useCreateProfile(topicId);
  const [summary, setSummary] = useState(profile?.summary ?? '');
  const [styleGuide, setStyleGuide] = useState(profile?.styleGuide ?? '');
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const save = () => {
    if (profile) {
      update.mutate(
        { id: profile.id, data: { summary, styleGuide } },
        { onSuccess: () => onOpenChange(false), onError },
      );
    } else {
      create.mutate(
        { summary, styleGuide },
        {
          onSuccess: (p) => {
            notify.success(t('profiles.created'));
            onCreated?.(p.id);
            onOpenChange(false);
          },
          onError,
        },
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={profile ? t('profiles.editProfile') : t('profiles.createTitle')}
      description={profile ? undefined : t('profiles.createHint')}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button isLoading={update.isPending || create.isPending} onClick={save}>
            {profile ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('profiles.summary')} hint={t('profiles.summaryHint')}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              dir="auto"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('profiles.styleGuide')} hint={t('profiles.styleGuideHint')}>
          {(id) => (
            <Textarea
              id={id}
              rows={16}
              dir="auto"
              value={styleGuide}
              onChange={(e) => setStyleGuide(e.target.value)}
              className="font-mono text-xs"
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export function ProfilePanel({
  topicId,
  activeProfileId,
}: {
  topicId: string;
  activeProfileId: string | null;
}) {
  const t = useT();
  const origin = useOrigin();
  const canWrite = useCanEditTopic(topicId);
  const profiles = useProfiles(topicId);
  const samples = useSamples(topicId);
  const brandDocs = useBrandDocs(topicId);
  const aiContext = useTopicAiContext(topicId);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [jobId, setJobId] = useState<string | null>(null);
  const [editingTrait, setEditingTrait] = useState<ProfileTrait | null>(null);
  const build = useBuildProfile(topicId);
  const approve = useApproveProfile();
  const archive = useArchiveProfile();
  const duplicate = useDuplicateProfile();
  const traitDialog = useDisclosure();
  const textDialog = useDisclosure();
  const createDialog = useDisclosure();

  const { isRunning } = useTrackJob(jobId, {
    invalidate: [profileKeys.all, ['topics']],
    onDone: (job) => {
      const output = job.output as { profileId?: string } | null;
      if (output?.profileId) setSelectedId(output.profileId);
      setJobId(null);
    },
  });

  const currentId = selectedId ?? activeProfileId ?? profiles.data?.[0]?.id;
  const profile = useProfile(currentId);
  const analyzedCount = samples.data?.filter((s) => s.analysisStatus === 'DONE').length ?? 0;
  const activeDocs = brandDocs.data?.filter((d) => d.isActive).length ?? 0;
  const businessSections = aiContext.data?.business?.filledSections ?? 0;
  const businessDocs = aiContext.data?.business?.references ?? 0;
  const canBuild = analyzedCount > 0 || activeDocs > 0 || businessSections > 0 || businessDocs > 0;
  // Approved and archived versions are locked; changes go through a new version.
  const isDraft = profile.data?.status === 'DRAFT';
  const editable = canWrite && isDraft;

  const grouped = useMemo(() => {
    const traits = profile.data?.traits ?? [];
    return TraitCategory.map((c) => ({
      category: c,
      traits: traits.filter((tr) => tr.category === c),
    })).filter((g) => g.traits.length);
  }, [profile.data]);

  const startBuild = () =>
    build.mutate(undefined, {
      onSuccess: (r) => {
        setJobId(r.jobId);
        notify.info(t('profiles.buildQueued'));
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  const startDuplicate = (id: string) =>
    duplicate.mutate(id, {
      onSuccess: (p) => {
        setSelectedId(p.id);
        notify.success(t('profiles.duplicated', { version: formatNumber(p.version) }));
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  if (profiles.isLoading) return <PageSpinner />;

  const headerActions = canWrite && (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" icon={<FilePlus2 />} onClick={createDialog.open}>
        {t('profiles.createManual')}
      </Button>
      <Button
        icon={<Wand2 />}
        onClick={startBuild}
        isLoading={build.isPending}
        disabled={isRunning || !canBuild}
      >
        {profiles.data?.length ? t('profiles.rebuild') : t('profiles.build')}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('profiles.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('profiles.subtitle')}</p>
        </div>
        {headerActions}
      </div>
      {canWrite &&
        !canBuild &&
        !samples.isLoading &&
        !brandDocs.isLoading &&
        !aiContext.isLoading && (
          <p className="text-sm text-warning">{t('profiles.needsAnalysis')}</p>
        )}
      {isRunning && <AiWorkingBanner hint={t('enums.jobType.BUILD_PROFILE')} />}

      {!profiles.data?.length ? (
        <Card>
          <EmptyState
            icon={<Layers />}
            title={t('profiles.empty')}
            description={t('profiles.emptyHint')}
            action={headerActions}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
          <Card className="h-fit">
            <CardHeader title={t('profiles.versions')} />
            <ul className="p-2">
              {profiles.data.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm transition',
                      p.id === currentId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                    )}
                  >
                    <span>
                      <span className="block font-medium">
                        {t('profiles.version', { version: formatNumber(p.version) })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {origin(p)} · {formatDate(p.createdAt, false)}
                      </span>
                    </span>
                    {p.isActive ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" />
                    ) : (
                      <Badge tone={statusTone[p.status]}>
                        {t(`enums.profileStatus.${p.status}`)}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {profile.isLoading || !profile.data ? (
            <PageSpinner />
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {t('profiles.version', { version: formatNumber(profile.data.version) })}
                      <Badge tone={statusTone[profile.data.status]}>
                        {t(`enums.profileStatus.${profile.data.status}`)}
                      </Badge>
                      {profile.data.isActive && (
                        <Badge tone="success">{t('profiles.active')}</Badge>
                      )}
                    </span>
                  }
                  description={[
                    origin(profile.data),
                    t('profiles.samplesUsed', {
                      count: formatNumber(profile.data.sampleIds.length),
                    }),
                    t('profiles.brandDocsUsed', {
                      count: formatNumber(profile.data.brandDocIds?.length ?? 0),
                    }),
                  ].join(' · ')}
                  actions={
                    canWrite && (
                      <>
                        {isDraft && (
                          <Button
                            variant="success"
                            icon={<CheckCircle2 />}
                            isLoading={approve.isPending}
                            onClick={() =>
                              approve.mutate(profile.data!.id, {
                                onSuccess: () => notify.success(t('profiles.approved')),
                                onError: (e) => notify.error(t('common.error'), e.message),
                              })
                            }
                          >
                            {t('profiles.approve')}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          icon={<Copy />}
                          isLoading={duplicate.isPending}
                          onClick={() => startDuplicate(profile.data!.id)}
                        >
                          {t('profiles.duplicate')}
                        </Button>
                        {profile.data.status !== 'ARCHIVED' && (
                          <ConfirmationDialog
                            tone="default"
                            confirmLabel={t('profiles.archive')}
                            title={t('profiles.archive')}
                            trigger={
                              <Button variant="outline" icon={<Archive />}>
                                {t('profiles.archive')}
                              </Button>
                            }
                            onConfirm={() => archive.mutateAsync(profile.data!.id)}
                          />
                        )}
                      </>
                    )
                  }
                />
                <CardBody className="space-y-4">
                  {isDraft ? (
                    <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
                      {t('profiles.draftNotice')}
                    </p>
                  ) : (
                    canWrite && (
                      <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                        <Lock className="mt-0.5 size-4 shrink-0" />
                        {t('profiles.lockedNotice')}
                      </p>
                    )
                  )}
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">{t('profiles.summary')}</h4>
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil />}
                          onClick={textDialog.open}
                        >
                          {t('profiles.editProfile')}
                        </Button>
                      )}
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground">
                      {profile.data.summary || '—'}
                    </p>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title={t('profiles.traits')}
                  actions={
                    editable && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Plus />}
                        onClick={traitDialog.open}
                      >
                        {t('profiles.addTrait')}
                      </Button>
                    )
                  }
                />
                <CardBody className="space-y-5">
                  {grouped.map((g) => (
                    <section key={g.category}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
                        {t(`enums.traitCategory.${g.category}`)}
                      </h4>
                      <ul className="space-y-2">
                        {g.traits.map((tr) => (
                          <TraitRow
                            key={tr.id}
                            trait={tr}
                            editable={editable}
                            onEdit={() => setEditingTrait(tr)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                  {!grouped.length && (
                    <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title={t('profiles.styleGuide')}
                  actions={
                    editable && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Pencil />}
                        onClick={textDialog.open}
                      >
                        {t('profiles.editGuide')}
                      </Button>
                    )
                  }
                />
                <CardBody>
                  {profile.data.styleGuide ? (
                    <MarkdownView>{profile.data.styleGuide}</MarkdownView>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </CardBody>
              </Card>

              {traitDialog.isOpen && (
                <TraitDialog profileId={profile.data.id} onOpenChange={traitDialog.setIsOpen} />
              )}
              {editingTrait && (
                <TraitDialog
                  profileId={profile.data.id}
                  trait={editingTrait}
                  onOpenChange={(open) => !open && setEditingTrait(null)}
                />
              )}
              {textDialog.isOpen && (
                <ProfileTextDialog
                  topicId={topicId}
                  profile={profile.data}
                  onOpenChange={textDialog.setIsOpen}
                />
              )}
            </div>
          )}
        </div>
      )}
      {createDialog.isOpen && (
        <ProfileTextDialog
          topicId={topicId}
          onOpenChange={createDialog.setIsOpen}
          onCreated={setSelectedId}
        />
      )}
    </div>
  );
}
