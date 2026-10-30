import { useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { TabBar } from '@/components/ui/tab-bar';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { useAiSettings, useUpdateAiSettings } from '@/features/admin/api';
import { GoogleDriveCard } from '@/features/businesses/components/google-drive-card';
import { GoogleAccessCard } from '@/features/settings/components/google-access-card';
import { NotificationSettingsCard } from '@/features/inbox/components/settings-card';
import { VariantSettingsCard } from '@/features/settings/components/variants-card';
import { GoldenSettingsCard } from '@/features/settings/components/golden-card';
import { SimilaritySettingsCard } from '@/features/settings/components/similarity-card';
import { ReadabilitySettingsCard } from '@/features/settings/components/readability-card';
import { AiKeyRow } from '@/features/settings/components/ai-key-row';
import { AiRoutingCard } from '@/features/settings/components/ai-routing-card';
import { BudgetCard } from '@/features/settings/components/budget-card';
import { WorkflowCard } from '@/features/settings/components/workflow-card';
import { UsersPanel } from '@/features/users/components/users-panel';

const PROVIDER_LABEL: Record<AiProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
};
const KEY_VAR: Record<AiProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const TABS = ['ai', 'users', 'quality', 'integrations'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsRoute() {
  const { data, isLoading } = useAiSettings();
  if (isLoading || !data) return <PageSpinner />;
  return <SettingsForm data={data} />;
}

function SettingsForm({ data }: { data: AiSettingsResponse }) {
  const t = useT();
  const isOwner = useUser()?.isOwner;
  const save = useUpdateAiSettings();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((x) => x === params.get('tab')) ?? 'ai';
  const [form, setForm] = useState<AiSettings>({
    models: data.models,
    effort: data.effort,
    maxSamplesPerProfile: data.maxSamplesPerProfile,
    fallbackModel: data.fallbackModel ?? '',
  });

  const [customModels, setCustomModels] = useState<string[]>([]);
  const [customProvider, setCustomProvider] = useState<AiProviderName>('openai');
  const [customId, setCustomId] = useState('');

  const configured = new Set(data.providers.filter((p) => p.configured).map((p) => p.name));
  const refs = [
    ...new Set([
      ...AI_MODEL_CATALOG.map((m) => modelRef(m.provider, m.id)),
      ...data.providers.flatMap((p) => (p.models ?? []).map((id) => modelRef(p.name, id))),
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
          tab === 'ai' && (
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
          )
        }
      />
      <TabBar
        value={tab}
        onChange={(next) => setParams({ tab: next }, { replace: true })}
        options={TABS.map((x) => ({ value: x, label: t(`settings.tabs.${x}`) }))}
        label={t('settings.title')}
      />
      {tab === 'ai' && (
        <>
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
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={t('settings.providers')}
                  description={t('settings.providersHint')}
                  descriptionAsTip
                />
                <CardBody className="space-y-4">
                  <ul className="space-y-2">
                    {data.providers.map((p) => (
                      <AiKeyRow key={p.name} status={p} label={PROVIDER_LABEL[p.name]} />
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
              <Card>
                <CardHeader title={t('settings.provider')} />
                <CardBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
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
              <CardHeader
                title={t('jobs.title')}
                description={t('settings.effortHint')}
                descriptionAsTip
              />
              <div className="hidden gap-3 border-b bg-muted/60 px-5 py-2.5 text-xs font-bold text-muted-foreground sm:grid sm:grid-cols-[1fr_minmax(0,16rem)_7rem]">
                <span>{t('settings.jobKind')}</span>
                <span>{t('settings.modelFor')}</span>
                <span>{t('settings.effort')}</span>
              </div>
              <div className="divide-y">
                {AiJobType.map((type) => (
                  <div
                    key={type}
                    className="grid items-center gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[1fr_minmax(0,16rem)_7rem]"
                  >
                    <p className="text-sm font-medium">{t(`enums.jobType.${type}`)}</p>
                    <Select
                      dir="ltr"
                      aria-label={`${t(`enums.jobType.${type}`)} — ${t('settings.modelFor')}`}
                      value={form.models[type] ?? ''}
                      onChange={(e) => setModel(type, e.target.value)}
                      placeholder={`${t('settings.inheritDefault')}`}
                      options={modelOptions}
                    />
                    <Select
                      aria-label={`${t(`enums.jobType.${type}`)} — ${t('settings.effort')}`}
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
                      options={AiEffort.map((e) => ({ value: e, label: t(`enums.effort.${e}`) }))}
                    />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
            <AiRoutingCard
              form={form}
              setForm={setForm}
              modelOptions={modelOptions}
              configured={configured}
              mock={data.mock}
            />
            <BudgetCard />
          </div>
        </>
      )}
      {tab === 'users' && <UsersPanel />}
      {tab === 'quality' && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <WorkflowCard />
          <div className="space-y-5">
            <ReadabilitySettingsCard />
            <SimilaritySettingsCard />
          </div>
          <GoldenSettingsCard />
          <VariantSettingsCard />
        </div>
      )}
      {tab === 'integrations' && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <NotificationSettingsCard />
          <GoogleDriveCard />
          {isOwner && (
            <div className="xl:col-span-2">
              <GoogleAccessCard />
            </div>
          )}
        </div>
      )}
    </>
  );
}
