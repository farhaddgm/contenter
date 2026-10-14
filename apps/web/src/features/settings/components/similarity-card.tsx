import { useState } from 'react';
import { Files } from 'lucide-react';
import { DEFAULT_SIMILARITY_SETTINGS, SimilaritySettingsSchema } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useSimilaritySettings, useUpdateSimilaritySettings } from '@/features/admin/api';

/** Percent scores from which a draft counts as "similar" and as "almost a copy" (docs/48). */
export function SimilaritySettingsCard() {
  const t = useT();
  const { data } = useSimilaritySettings();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Files className="size-4" />
            {t('contents.similarity.settings.title')}
          </span>
        }
        description={t('contents.similarity.settings.subtitle')}
      />
      <CardBody>
        {!data ? (
          <Spinner />
        ) : (
          <SimilarityForm
            key={`${data.warnAt}-${data.copyAt}`}
            warnAt={Math.round(data.warnAt * 100)}
            copyAt={Math.round(data.copyAt * 100)}
          />
        )}
      </CardBody>
    </Card>
  );
}

function SimilarityForm({ warnAt, copyAt }: { warnAt: number; copyAt: number }) {
  const t = useT();
  const save = useUpdateSimilaritySettings();
  const [warn, setWarn] = useState(String(warnAt));
  const [copy, setCopy] = useState(String(copyAt));
  const parsed = SimilaritySettingsSchema.safeParse({
    warnAt: Number(warn) / 100,
    copyAt: Number(copy) / 100,
  });
  const defaults = DEFAULT_SIMILARITY_SETTINGS;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Field label={t('contents.similarity.settings.warnAt')} className="w-44">
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={20}
              max={95}
              value={warn}
              onChange={(e) => setWarn(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('contents.similarity.settings.copyAt')} className="w-44">
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={30}
              max={100}
              value={copy}
              onChange={(e) => setCopy(e.target.value)}
            />
          )}
        </Field>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        {t('contents.similarity.settings.hint', {
          warn: Math.round(defaults.warnAt * 100),
          copy: Math.round(defaults.copyAt * 100),
        })}
      </p>
      {!parsed.success && (
        <p className="text-sm text-destructive">{t('contents.similarity.settings.invalid')}</p>
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
