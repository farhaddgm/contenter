import { useState } from 'react';
import { Info } from 'lucide-react';
import { AiEffort, AiJobType, type AiSettings } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useAiSettings, useUpdateAiSettings, type AiSettingsResponse } from '@/features/admin/api';

const MODELS = [
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
  'claude-sonnet-5',
  'claude-haiku-4-5',
];

export default function SettingsRoute() {
  const { data, isLoading } = useAiSettings();
  if (isLoading || !data) return <PageSpinner />;
  return <SettingsForm data={data} />;
}

function SettingsForm({ data }: { data: AiSettingsResponse }) {
  const t = useT();
  const save = useUpdateAiSettings();
  const [form, setForm] = useState<AiSettings>({
    models: data.models,
    effort: data.effort,
    maxSamplesPerProfile: data.maxSamplesPerProfile,
  });

  const modelOptions = [...new Set([...MODELS, ...Object.values(form.models)])].map((m) => ({
    value: m,
    label: m,
  }));
  const setModel = (key: string, value: string) =>
    setForm((f) => {
      const models = { ...f.models };
      if (value) models[key] = value;
      else delete models[key];
      return { ...f, models };
    });

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.subtitle')}
        actions={
          <Button
            isLoading={save.isPending}
            onClick={() =>
              save.mutate(form, {
                onSuccess: () => notify.success(t('common.saved')),
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            {t('common.save')}
          </Button>
        }
      />
      {data.provider === 'mock' && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
          <Info className="size-4" /> {t('settings.mockNotice')}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardHeader
            title={t('settings.provider')}
            description={<Badge tone="primary">{data.provider}</Badge>}
          />
          <CardBody className="space-y-4">
            <Field label={t('settings.defaultModel')}>
              {(id) => (
                <Select
                  id={id}
                  dir="ltr"
                  value={form.models.default ?? ''}
                  onChange={(e) => setModel('default', e.target.value)}
                  options={modelOptions}
                />
              )}
            </Field>
            <Field label={t('settings.maxSamples')}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxSamplesPerProfile}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxSamplesPerProfile: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    })
                  }
                />
              )}
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('jobs.title')} description={t('settings.effortHint')} />
          <div className="divide-y">
            {AiJobType.map((type) => (
              <div
                key={type}
                className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_14rem_10rem]"
              >
                <p className="font-medium">{t(`enums.jobType.${type}`)}</p>
                <Select
                  dir="ltr"
                  value={form.models[type] ?? ''}
                  onChange={(e) => setModel(type, e.target.value)}
                  placeholder={`${t('settings.inheritDefault')}`}
                  options={modelOptions}
                />
                <Select
                  dir="ltr"
                  value={form.effort[type] ?? 'high'}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      effort: {
                        ...form.effort,
                        [type]: e.target.value as (typeof AiEffort)[number],
                      },
                    })
                  }
                  options={AiEffort.map((e) => ({ value: e, label: e }))}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
