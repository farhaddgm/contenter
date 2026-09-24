import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateSampleSchema, type CreateSampleInput } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Switch, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useCreateSample } from '../api/samples';

export function AddSampleDrawer({
  topicId,
  open,
  onOpenChange,
}: {
  topicId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateSample(topicId);
  const form = useForm<CreateSampleInput>({
    resolver: zodResolver(CreateSampleSchema),
    defaultValues: { url: '', manualText: '', adminNote: '', autoAnalyze: true },
  });

  useEffect(() => {
    if (open) form.reset({ url: '', manualText: '', adminNote: '', autoAnalyze: true });
  }, [open, form]);

  const onSubmit = form.handleSubmit((values) =>
    create.mutate(values, {
      onSuccess: (sample) => {
        notify.success(
          t('samples.added'),
          sample.fetchStatus === 'FAILED' ? (sample.fetchError ?? undefined) : undefined,
        );
        if (values.autoAnalyze) notify.info(t('samples.analysisQueued'));
        onOpenChange(false);
      },
      onError: (e) => notify.error(t('common.error'), e.message),
    }),
  );

  const errors = form.formState.errors;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('samples.add')}
      description={t('samples.subtitle')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="sample-form" isLoading={create.isPending}>
            {t('samples.add')}
          </Button>
        </>
      }
    >
      <form id="sample-form" onSubmit={onSubmit} className="space-y-5">
        <Field label={t('samples.url')} hint={t('samples.urlHint')} error={errors.url?.message}>
          {(id) => (
            <Input id={id} dir="ltr" placeholder="https://" autoFocus {...form.register('url')} />
          )}
        </Field>
        <Field
          label={t('samples.manualText')}
          hint={t('samples.manualTextHint')}
          optional={t('common.optional')}
          error={errors.manualText?.message}
        >
          {(id) => <Textarea id={id} rows={8} {...form.register('manualText')} />}
        </Field>
        <Field
          label={t('samples.adminNote')}
          hint={t('samples.adminNoteHint')}
          optional={t('common.optional')}
        >
          {(id) => <Textarea id={id} rows={2} {...form.register('adminNote')} />}
        </Field>
        <Controller
          control={form.control}
          name="autoAnalyze"
          render={({ field }) => (
            <Switch
              checked={!!field.value}
              onCheckedChange={field.onChange}
              label={t('samples.autoAnalyze')}
            />
          )}
        />
      </form>
    </Drawer>
  );
}
