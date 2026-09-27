import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateBusinessSchema, type Business, type CreateBusinessInput } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useCreateBusiness, useUpdateBusiness } from '../api/businesses';

export const CONTENT_LANGS = [
  { value: 'fa', label: 'فارسی' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'tr', label: 'Türkçe' },
];

/** Create/edit the basic info of a business. Mounted only while open. */
export function BusinessFormDrawer({
  onOpenChange,
  business,
  onCreated,
}: {
  onOpenChange: (v: boolean) => void;
  business?: Business;
  onCreated?: (b: Business) => void;
}) {
  const t = useT();
  const create = useCreateBusiness();
  const update = useUpdateBusiness(business?.id ?? '');
  const form = useForm<CreateBusinessInput>({
    resolver: zodResolver(CreateBusinessSchema),
    defaultValues: {
      name: business?.name ?? '',
      tagline: business?.tagline ?? '',
      industry: business?.industry ?? '',
      website: business?.website ?? '',
      location: business?.location ?? '',
      language: business?.language ?? 'fa',
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    const opts = { onError: (e: Error) => notify.error(t('common.error'), e.message) };
    if (business) {
      update.mutate(values, {
        ...opts,
        onSuccess: () => {
          notify.success(t('common.saved'));
          onOpenChange(false);
        },
      });
    } else {
      create.mutate(values, {
        ...opts,
        onSuccess: (created) => {
          notify.success(t('businesses.created'));
          onOpenChange(false);
          onCreated?.(created);
        },
      });
    }
  });

  const errors = form.formState.errors;
  return (
    <Drawer
      open
      onOpenChange={onOpenChange}
      title={business ? t('businesses.editInfo') : t('businesses.new')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="business-form"
            isLoading={create.isPending || update.isPending}
          >
            {business ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form id="business-form" onSubmit={onSubmit} className="space-y-5">
        <Field label={t('businesses.fields.name')} error={errors.name?.message}>
          {(id) => <Input id={id} {...form.register('name')} />}
        </Field>
        <Field
          label={t('businesses.fields.tagline')}
          optional={t('common.optional')}
          error={errors.tagline?.message}
        >
          {(id) => <Input id={id} {...form.register('tagline')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('businesses.fields.industry')}
            optional={t('common.optional')}
            error={errors.industry?.message}
          >
            {(id) => <Input id={id} {...form.register('industry')} />}
          </Field>
          <Field
            label={t('businesses.fields.location')}
            optional={t('common.optional')}
            error={errors.location?.message}
          >
            {(id) => <Input id={id} {...form.register('location')} />}
          </Field>
        </div>
        <Field
          label={t('businesses.fields.website')}
          optional={t('common.optional')}
          error={errors.website?.message}
        >
          {(id) => <Input id={id} dir="ltr" placeholder="https://" {...form.register('website')} />}
        </Field>
        <Field label={t('businesses.fields.language')}>
          {(id) => <Select id={id} options={CONTENT_LANGS} {...form.register('language')} />}
        </Field>
      </form>
    </Drawer>
  );
}
