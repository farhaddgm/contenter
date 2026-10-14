import { useState } from 'react';
import { Award } from 'lucide-react';
import { GOLDEN_MAX_EXAMPLES, GoldenSettingsSchema, type GoldenSettings } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useGoldenSettings, useUpdateGoldenSettings } from '@/features/admin/api';

/** How many golden examples ride in a draft's prompt and how long each may be (docs/49). */
export function GoldenSettingsCard() {
  const t = useT();
  const { data } = useGoldenSettings();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Award className="size-4" />
            {t('golden.settings.title')}
          </span>
        }
        description={t('golden.settings.subtitle')}
      />
      <CardBody>
        {!data ? (
          <Spinner />
        ) : (
          <GoldenForm key={`${data.maxExamples}-${data.maxChars}`} saved={data} />
        )}
      </CardBody>
    </Card>
  );
}

function GoldenForm({ saved }: { saved: GoldenSettings }) {
  const t = useT();
  const save = useUpdateGoldenSettings();
  const [count, setCount] = useState(String(saved.maxExamples));
  const [chars, setChars] = useState(String(saved.maxChars));
  const parsed = GoldenSettingsSchema.safeParse({
    maxExamples: Number(count),
    maxChars: Number(chars),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Field
          label={t('golden.settings.count')}
          hint={t('golden.settings.countHint', { max: GOLDEN_MAX_EXAMPLES })}
          className="w-44"
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={GOLDEN_MAX_EXAMPLES}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('golden.settings.chars')} className="w-44">
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={300}
              max={4000}
              value={chars}
              onChange={(e) => setChars(e.target.value)}
            />
          )}
        </Field>
      </div>
      {!parsed.success && (
        <p className="text-sm text-destructive">{t('golden.settings.invalid')}</p>
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
