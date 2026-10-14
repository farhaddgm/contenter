import { useState } from 'react';
import { Shuffle, TriangleAlert } from 'lucide-react';
import { parseModelRef, suggestRouting, type AiSettings } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, type SelectOption } from '@/components/ui/form-controls';
import { useT } from '@/i18n';

/**
 * Fallback model and cost routing (docs/44-reliability-and-cost.md). Both only edit the settings
 * form; nothing is saved until the page's Save button is pressed.
 */
export function AiRoutingCard({
  form,
  setForm,
  modelOptions,
  configured,
  mock,
}: {
  form: AiSettings;
  setForm: (next: AiSettings) => void;
  modelOptions: SelectOption[];
  configured: Set<string>;
  mock: boolean;
}) {
  const t = useT();
  const [strong, setStrong] = useState(form.models.default ?? '');
  const [light, setLight] = useState('');
  const fallback = form.fallbackModel ?? '';
  const fallbackVendor = fallback ? parseModelRef(fallback).provider : null;
  const defaultVendor = form.models.default ? parseModelRef(form.models.default).provider : null;
  const noKey = !!fallbackVendor && !mock && !configured.has(fallbackVendor);
  const sameVendor = !!fallbackVendor && fallbackVendor === defaultVendor;

  return (
    <Card className="h-fit">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Shuffle className="size-4" />
            {t('settings.reliability.title')}
          </span>
        }
        description={t('settings.reliability.subtitle')}
      />
      <CardBody className="space-y-5">
        <Field
          label={t('settings.reliability.fallback')}
          hint={t('settings.reliability.fallbackHint')}
        >
          {(id) => (
            <Select
              id={id}
              dir="ltr"
              value={fallback}
              onChange={(e) => setForm({ ...form, fallbackModel: e.target.value })}
              placeholder={t('settings.reliability.noFallback')}
              options={modelOptions}
            />
          )}
        </Field>
        {noKey && (
          <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs leading-5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t('settings.reliability.fallbackNoKey')}
          </p>
        )}
        {sameVendor && !noKey && (
          <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs leading-5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t('settings.reliability.sameVendor')}
          </p>
        )}

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{t('settings.reliability.routing')}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t('settings.reliability.routingHint')}
          </p>
          <Field label={t('settings.reliability.strong')}>
            {(id) => (
              <Select
                id={id}
                dir="ltr"
                value={strong}
                onChange={(e) => setStrong(e.target.value)}
                placeholder="—"
                options={modelOptions}
              />
            )}
          </Field>
          <Field label={t('settings.reliability.light')}>
            {(id) => (
              <Select
                id={id}
                dir="ltr"
                value={light}
                onChange={(e) => setLight(e.target.value)}
                placeholder="—"
                options={modelOptions}
              />
            )}
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={!strong || !light}
            onClick={() => setForm({ ...form, models: suggestRouting(strong, light) })}
          >
            {t('settings.reliability.apply')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
