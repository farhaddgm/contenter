import { useState } from 'react';
import { Link } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Archive,
  ArchiveRestore,
  CalendarRange,
  Megaphone,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { CreateCampaignSchema, type Campaign, type CreateCampaignInput } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';
import {
  useCampaigns,
  useCreateCampaign,
  useDeleteCampaign,
  useUpdateCampaign,
} from '../api/campaigns';

/** `<input type="date">` over an ISO timestamp: the day is kept as UTC midnight. */
function DateInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
}) {
  return (
    <Input
      id={id}
      type="date"
      value={value ? value.slice(0, 10) : ''}
      onChange={(e) => onChange(e.target.value ? `${e.target.value}T00:00:00.000Z` : null)}
    />
  );
}

/** Mounted only while open, so the form starts from the campaign it edits without a reset effect. */
function CampaignFormDialog({
  topicId,
  campaign,
  onOpenChange,
}: {
  topicId: string;
  campaign?: Campaign;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateCampaign(topicId);
  const update = useUpdateCampaign();
  const form = useForm<CreateCampaignInput>({
    resolver: zodResolver(CreateCampaignSchema),
    defaultValues: {
      name: campaign?.name ?? '',
      description: campaign?.description ?? '',
      startsAt: campaign?.startsAt ?? null,
      endsAt: campaign?.endsAt ?? null,
    },
  });
  const onSuccess = () => {
    notify.success(t('common.saved'));
    onOpenChange(false);
  };
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const submit = form.handleSubmit((values) =>
    campaign
      ? update.mutate({ id: campaign.id, data: values }, { onSuccess, onError })
      : create.mutate(values, { onSuccess, onError }),
  );
  const errors = form.formState.errors;
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={campaign ? t('campaigns.edit') : t('campaigns.new')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="campaign-form"
            isLoading={create.isPending || update.isPending}
          >
            {campaign ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form id="campaign-form" onSubmit={submit} className="space-y-4">
        <Field label={t('campaigns.name')} error={errors.name?.message}>
          {(id) => <Input id={id} dir="auto" autoFocus {...form.register('name')} />}
        </Field>
        <Field
          label={t('campaigns.description')}
          optional={t('common.optional')}
          error={errors.description?.message}
        >
          {(id) => <Textarea id={id} dir="auto" rows={3} {...form.register('description')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="startsAt"
            render={({ field }) => (
              <Field label={t('campaigns.startsAt')} optional={t('common.optional')}>
                {(id) => <DateInput id={id} value={field.value} onChange={field.onChange} />}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="endsAt"
            render={({ field }) => (
              <Field
                label={t('campaigns.endsAt')}
                optional={t('common.optional')}
                error={errors.endsAt?.message}
              >
                {(id) => <DateInput id={id} value={field.value} onChange={field.onChange} />}
              </Field>
            )}
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t('campaigns.datesHint')}</p>
      </form>
    </Dialog>
  );
}

function CampaignRow({ campaign, editable }: { campaign: Campaign; editable: boolean }) {
  const t = useT();
  const update = useUpdateCampaign();
  const remove = useDeleteCampaign();
  const dialog = useDisclosure();
  const archived = campaign.status === 'ARCHIVED';
  const range =
    campaign.startsAt || campaign.endsAt
      ? `${campaign.startsAt ? formatDate(campaign.startsAt, false) : '…'} – ${campaign.endsAt ? formatDate(campaign.endsAt, false) : '…'}`
      : null;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`${paths.app.topic.getHref(campaign.topicId, 'contents')}?campaignId=${campaign.id}`}
            className="font-medium hover:text-primary"
            dir="auto"
          >
            {campaign.name}
          </Link>
          <Badge tone={statusTone[campaign.status]}>
            {t(`enums.campaignStatus.${campaign.status}`)}
          </Badge>
          {range && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarRange className="size-3.5" />
              {range}
            </span>
          )}
        </div>
        {campaign.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
            {campaign.description}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {t('campaigns.contentCount', { count: formatNumber(campaign._count?.contents ?? 0) })}
      </span>
      {editable && (
        <span className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('common.edit')}
            onClick={dialog.open}
          >
            <Pencil />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={archived ? t('campaigns.unarchive') : t('campaigns.archive')}
            isLoading={update.isPending}
            icon={archived ? <ArchiveRestore /> : <Archive />}
            onClick={() =>
              update.mutate({
                id: campaign.id,
                data: { status: archived ? 'ACTIVE' : 'ARCHIVED' },
              })
            }
          />
          <ConfirmationDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                <Trash2 className="text-muted-foreground" />
              </Button>
            }
            body={t('campaigns.deleteBody')}
            onConfirm={() => remove.mutateAsync(campaign.id)}
          />
        </span>
      )}
      {dialog.isOpen && (
        <CampaignFormDialog
          topicId={campaign.topicId}
          campaign={campaign}
          onOpenChange={dialog.setIsOpen}
        />
      )}
    </li>
  );
}

/** The campaigns (and collections: campaigns without dates) of one topic. */
export function CampaignsPanel({ topicId }: { topicId: string }) {
  const t = useT();
  const editable = useCanEditTopic(topicId);
  const { data: campaigns, isLoading } = useCampaigns(topicId);
  const dialog = useDisclosure();
  const [showArchived, setShowArchived] = useState(false);
  const shown = (campaigns ?? []).filter((c) => showArchived || c.status === 'ACTIVE');
  const archivedCount = (campaigns ?? []).filter((c) => c.status === 'ARCHIVED').length;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Megaphone className="size-4" />
            {t('campaigns.title')}
          </span>
        }
        description={t('campaigns.subtitle')}
        actions={
          <>
            {archivedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowArchived((v) => !v)}>
                {showArchived
                  ? t('campaigns.hideArchived')
                  : t('campaigns.showArchived', { count: formatNumber(archivedCount) })}
              </Button>
            )}
            {editable && (
              <Button size="sm" icon={<Plus />} onClick={dialog.open}>
                {t('campaigns.new')}
              </Button>
            )}
          </>
        }
      />
      {isLoading ? (
        <PageSpinner />
      ) : !shown.length ? (
        <EmptyState icon={<Megaphone />} title={t('campaigns.empty')} />
      ) : (
        <ul className="divide-y">
          {shown.map((c) => (
            <CampaignRow key={c.id} campaign={c} editable={editable} />
          ))}
        </ul>
      )}
      {dialog.isOpen && <CampaignFormDialog topicId={topicId} onOpenChange={dialog.setIsOpen} />}
    </Card>
  );
}
