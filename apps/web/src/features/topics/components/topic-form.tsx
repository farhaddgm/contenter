import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateTopicSchema,
  Platform,
  isStyleUsable,
  type CreateTopicInput,
  type Topic,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useBusinessOptions } from '@/features/businesses/api/businesses';
import { useFocusOptions } from '@/features/businesses/api/focus';
import { useStyles } from '@/features/businesses/api/styles';
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
      styleId: null,
      offeringId: null,
      segmentId: null,
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
              styleId: topic.styleId ?? null,
              offeringId: topic.offeringId ?? null,
              segmentId: topic.segmentId ?? null,
            }
          : {
              title: '',
              description: '',
              audience: '',
              platform: 'INSTAGRAM',
              language: 'fa',
              businessId: defaultBusinessId ?? null,
              styleId: null,
              offeringId: null,
              segmentId: null,
            },
      );
    }
  }, [open, topic, form, defaultBusinessId]);

  // Archived businesses stay selectable only for the topic already linked to them.
  const businessOptions = (businesses.data ?? [])
    .filter((b) => b.status === 'ACTIVE' || b.id === topic?.businessId)
    .map((b) => ({ value: b.id, label: b.name }));

  // Only built and confirmed styles of the chosen business can be picked; the current one stays visible.
  const chosenBusiness = useWatch({ control: form.control, name: 'businessId' });
  const styles = useStyles(chosenBusiness);
  const styleOptions = (styles.data ?? [])
    .filter((s) => isStyleUsable(s) || s.id === topic?.styleId)
    .map((s) => ({ value: s.id, label: s.name }));

  // an offering and an audience of the chosen business (docs/73)
  const focus = useFocusOptions(chosenBusiness, topic);

  const onSubmit = form.handleSubmit((raw) => {
    // a style, offering or audience left over from another business is dropped
    const values = {
      ...raw,
      styleId: styleOptions.some((o) => o.value === raw.styleId) ? raw.styleId : null,
      offeringId: focus.offeringOptions.some((o) => o.value === raw.offeringId) ? raw.offeringId : null,
      segmentId: focus.segmentOptions.some((o) => o.value === raw.segmentId) ? raw.segmentId : null,
    };
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
        {chosenBusiness && styleOptions.length > 0 && (
          <Field
            label={t('topics.fields.style')}
            hint={t('topics.fields.styleHint')}
            error={errors.styleId?.message}
          >
            {(id) => (
              <Select
                id={id}
                placeholder={t('topics.noStyle')}
                options={styleOptions}
                {...form.register('styleId', { setValueAs: (v: string | null) => v || null })}
              />
            )}
          </Field>
        )}
        {chosenBusiness && focus.offeringOptions.length > 0 && (
          <Field
            label={t('topics.fields.offering')}
            hint={t('topics.fields.offeringHint')}
            error={errors.offeringId?.message}
          >
            {(id) => (
              <Select
                id={id}
                placeholder={t('topics.noOffering')}
                options={focus.offeringOptions}
                {...form.register('offeringId', { setValueAs: (v: string | null) => v || null })}
              />
            )}
          </Field>
        )}
        {chosenBusiness && focus.segmentOptions.length > 0 && (
          <Field
            label={t('topics.fields.segment')}
            hint={t('topics.fields.segmentHint')}
            error={errors.segmentId?.message}
          >
            {(id) => (
              <Select
                id={id}
                placeholder={t('topics.noSegment')}
                options={focus.segmentOptions}
                {...form.register('segmentId', { setValueAs: (v: string | null) => v || null })}
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
