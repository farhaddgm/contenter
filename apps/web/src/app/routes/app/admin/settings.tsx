import { useState } from 'react';
import { Info, Plus, TriangleAlert } from 'lucide-react';
import {
  AI_MODEL_CATALOG,
  AiEffort,
  AiJobType,
  AiProviderName,
  MODEL_REF_PATTERN,
  modelRef,
  parseModelRef,
  type AiSettings,
  type AiSettingsResponse,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useAiSettings, useUpdateAiSettings } from '@/features/admin/api';
import { SmartSettingsCard } from '@/features/smart/components/smart-settings-card';

const PROVIDER_LABEL: Record<AiProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
};
const KEY_VAR: Record<AiProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

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

  const [customModels, setCustomModels] = useState<string[]>([]);
  const [customProvider, setCustomProvider] = useState<AiProviderName>('openai');
  const [customId, setCustomId] = useState('');

  const configured = new Set(data.providers.filter((p) => p.configured).map((p) => p.name));
  const refs = [
    ...new Set([
      ...AI_MODEL_CATALOG.map((m) => modelRef(m.provider, m.id)),
      ...customModels,
      ...Object.values(form.models),
    ]),
  ];
  const modelOptions = AiProviderName.flatMap((provider) =>
    refs
      .map(parseModelRef)
      .filter((m) => m.provider === provider)
      .map((m) => ({
        value: modelRef(m.provider, m.model),
        label: `${PROVIDER_LABEL[provider]} · ${m.model}${
          data.mock || configured.has(provider) ? '' : ` (${t('settings.unavailable')})`
        }`,
      })),
  );
  const usesMissingKey =
    !data.mock &&
    Object.values(form.models).some((ref) => !configured.has(parseModelRef(ref).provider));
  const customRef = modelRef(customProvider, customId.trim());
  const addCustom = () => {
    if (!MODEL_REF_PATTERN.test(customRef)) return;
    setCustomModels((list) => [...list, customRef]);
    setCustomId('');
  };
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
      {data.mock && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
          <Info className="size-4 shrink-0" /> {t('settings.mockNotice')}
        </p>
      )}
      {usesMissingKey && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlert className="size-4 shrink-0" /> {t('settings.missingKeyWarning')}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader title={t('settings.providers')} description={t('settings.providersHint')} />
            <CardBody className="space-y-4">
              <ul className="space-y-2">
                {data.providers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{PROVIDER_LABEL[p.name]}</span>
                    <Badge tone={p.configured ? 'success' : 'neutral'}>
                      {p.configured ? t('settings.connected') : t('settings.noKey')}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t('settings.keyHint', {
                  vars: data.providers.map((p) => KEY_VAR[p.name]).join(' / '),
                })}
              </p>
              <Field label={t('settings.customModel')} hint={t('settings.customModelHint')}>
                {(id) => (
                  <div className="flex gap-2">
                    <Select
                      dir="ltr"
                      className="w-28"
                      value={customProvider}
                      onChange={(e) => setCustomProvider(e.target.value as AiProviderName)}
                      options={AiProviderName.map((p) => ({ value: p, label: p }))}
                    />
                    <Input
                      id={id}
                      dir="ltr"
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                      placeholder="gpt-5.4"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t('settings.add')}
                      disabled={!customId.trim() || !MODEL_REF_PATTERN.test(customRef)}
                      onClick={addCustom}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                )}
              </Field>
            </CardBody>
          </Card>
          <Card className="h-fit">
            <CardHeader title={t('settings.provider')} />
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
                        maxSamplesPerProfile: Math.max(
                          1,
                          Math.min(50, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                )}
              </Field>
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title={t('jobs.title')} description={t('settings.effortHint')} />
          <div className="divide-y">
            {AiJobType.map((type) => (
              <div
                key={type}
                className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_18rem_8rem]"
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
      <div className="mt-6">
        <SmartSettingsCard />
      </div>
    </>
  );
}
