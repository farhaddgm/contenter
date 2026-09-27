import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateTopicSchema, Platform, type CreateTopicInput, type Topic } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useBusinessOptions } from '@/features/businesses/api/businesses';
import { useCreateTopic, useUpdateTopic } from '../api/topics';

const LANGS = [
  { value: 'fa', label: 'فارسی' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'tr', label: 'Türkçe' },
];

/** Create/edit topic in a side drawer (bulletproof-react FormDrawer pattern). */
export function TopicFormDrawer({
  open,
  onOpenChange,
  topic,
  onCreated,
  defaultBusinessId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  topic?: Topic;
  onCreated?: (t: Topic) => void;
  /** Preselected business for a new topic. */
  defaultBusinessId?: string | null;
}) {
  const t = useT();
  const create = useCreateTopic();
  const update = useUpdateTopic(topic?.id ?? '');
  const businesses = useBusinessOptions();
  const form = useForm<CreateTopicInput>({
    resolver: zodResolver(CreateTopicSchema),
    defaultValues: {
      title: '',
      description: '',
      audience: '',
      platform: 'INSTAGRAM',
      language: 'fa',
      businessId: null,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(
        topic
          ? {
              title: topic.title,
              description: topic.description,
              audience: topic.audience,
              platform: topic.platform,
              language: topic.language,
              businessId: topic.businessId,
            }
          : {
              title: '',
              description: '',
              audience: '',
              platform: 'INSTAGRAM',
              language: 'fa',
              businessId: defaultBusinessId ?? null,
            },
      );
    }
  }, [open, topic, form, defaultBusinessId]);

  // Archived businesses stay selectable only for the topic already linked to them.
  const businessOptions = (businesses.data ?? [])
    .filter((b) => b.status === 'ACTIVE' || b.id === topic?.businessId)
    .map((b) => ({ value: b.id, label: b.name }));

  const onSubmit = form.handleSubmit((values) => {
    if (topic) {
      update.mutate(values, {
        onSuccess: () => {
          notify.success(t('common.saved'));
          onOpenChange(false);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      });
    } else {
      create.mutate(values, {
        onSuccess: (created) => {
          notify.success(t('topics.created'));
          onOpenChange(false);
          onCreated?.(created);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      });
    }
  });

  const errors = form.formState.errors;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={topic ? t('topics.editTopic') : t('topics.new')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="topic-form" isLoading={create.isPending || update.isPending}>
            {topic ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form id="topic-form" onSubmit={onSubmit} className="space-y-5">
        <Field label={t('topics.fields.title')} error={errors.title?.message}>
          {(id) => <Input id={id} {...form.register('title')} />}
        </Field>
        {/* Rendered once the options exist, so the uncontrolled select can show the value. */}
        {businesses.data && (
          <Field
            label={t('topics.fields.business')}
            hint={t('topics.fields.businessHint')}
            error={errors.businessId?.message}
          >
            {(id) => (
              <Select
                id={id}
                placeholder={t('topics.noBusiness')}
                options={businessOptions}
                {...form.register('businessId', { setValueAs: (v: string | null) => v || null })}
              />
            )}
          </Field>
        )}
        <Field
          label={t('topics.fields.description')}
          hint={t('topics.fields.descriptionHint')}
          error={errors.description?.message}
        >
          {(id) => <Textarea id={id} rows={7} {...form.register('description')} />}
        </Field>
        <Field
          label={t('topics.fields.audience')}
          optional={t('common.optional')}
          error={errors.audience?.message}
        >
          {(id) => <Textarea id={id} rows={2} {...form.register('audience')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('topics.fields.platform')}>
            {(id) => (
              <Select
                id={id}
                options={Platform.map((p) => ({ value: p, label: t(`enums.platform.${p}`) }))}
                {...form.register('platform')}
              />
            )}
          </Field>
          <Field label={t('topics.fields.language')}>
            {(id) => <Select id={id} options={LANGS} {...form.register('language')} />}
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
