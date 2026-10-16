import { useState } from 'react';
import { Columns3 } from 'lucide-react';
import { VariantSettingsSchema, type VariantSettings } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useUpdateVariantSettings, useVariantSettings } from '@/features/admin/api';

/** The most drafts one generate request may ask for (docs/51); each one costs a generation. */
export function VariantSettingsCard() {
  const t = useT();
  const { data } = useVariantSettings();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Columns3 className="size-4" />
            {t('variants.settings.title')}
          </span>
        }
        description={t('variants.settings.subtitle')}
      />
      <CardBody>
        {!data ? <Spinner /> : <VariantForm key={data.maxVariants} saved={data} />}
      </CardBody>
    </Card>
  );
}

function VariantForm({ saved }: { saved: VariantSettings }) {
  const t = useT();
  const save = useUpdateVariantSettings();
  const [max, setMax] = useState(String(saved.maxVariants));
  const parsed = VariantSettingsSchema.safeParse({ maxVariants: Number(max) });
  return (
    <div className="space-y-4">
      <Field label={t('variants.settings.max')} className="w-44">
        {(id) => (
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={1}
            max={3}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        )}
      </Field>
      {!parsed.success && (
        <p className="text-sm text-destructive">{t('variants.settings.invalid')}</p>
      )}
      <Button
        isLoading={save.isPending}
        disabled={!parsed.success}
        onClick={() =>
          parsed.success &&
          save.mutate(parsed.data, {
            onSuccess: () => notify.success(t('common.saved')),
            onError: (e) => notify.error(t('common.error'), e.message),
          })
        }
      >
        {t('common.save')}
      </Button>
    </div>
  );
}
