import { useState } from 'react';
import { Gauge } from 'lucide-react';
import {
  DEFAULT_STIFF_PHRASES,
  READABILITY_MAX_EXTRA_PHRASES,
  READABILITY_PHRASE_MAX_CHARS,
  type ReadabilitySettings,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useReadabilitySettings, useUpdateReadabilitySettings } from '@/features/admin/api';

/** Extra stiff phrases and a sentence-length limit for the readability card (docs/47). */
export function ReadabilitySettingsCard() {
  const t = useT();
  const { data } = useReadabilitySettings();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-4" />
            {t('contents.readability.settings.title')}
          </span>
        }
        description={t('contents.readability.settings.subtitle')}
      />
      <CardBody>
        {!data ? <Spinner /> : <ReadabilityForm key={JSON.stringify(data)} saved={data} />}
      </CardBody>
    </Card>
  );
}

function ReadabilityForm({ saved }: { saved: ReadabilitySettings }) {
  const t = useT();
  const save = useUpdateReadabilitySettings();
  const [phrases, setPhrases] = useState(saved.extraPhrases.join('\n'));
  const [limit, setLimit] = useState(saved.maxAvgSentenceWords?.toString() ?? '');

  const parsed = phrases
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const limitNum = limit.trim() === '' ? null : Number(limit);
  const tooMany = parsed.length > READABILITY_MAX_EXTRA_PHRASES;
  const badPhrase = parsed.some((p) => p.length < 2 || p.length > READABILITY_PHRASE_MAX_CHARS);
  const badLimit =
    limitNum !== null && (!Number.isInteger(limitNum) || limitNum < 5 || limitNum > 80);

  return (
    <div className="space-y-4">
      <Field
        label={t('contents.readability.settings.phrases')}
        hint={t('contents.readability.settings.phrasesHint')}
      >
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            data-bidi=""
            value={phrases}
            onChange={(e) => setPhrases(e.target.value)}
            placeholder={t('contents.readability.settings.phrasesPlaceholder')}
          />
        )}
      </Field>
      <p className="text-xs leading-6 text-muted-foreground" data-bidi="">
        {t('contents.readability.settings.builtIn')} {DEFAULT_STIFF_PHRASES.join('، ')}
      </p>
      <Field
        label={t('contents.readability.settings.limit')}
        hint={t('contents.readability.settings.limitHint')}
      >
        {(id) => (
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={5}
            max={80}
            className="w-32"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        )}
      </Field>
      {(tooMany || badPhrase || badLimit) && (
        <p className="text-sm text-destructive">{t('contents.readability.settings.invalid')}</p>
      )}
      <Button
        isLoading={save.isPending}
        disabled={tooMany || badPhrase || badLimit}
        onClick={() =>
          save.mutate(
            { extraPhrases: parsed, maxAvgSentenceWords: limitNum },
            {
              onSuccess: () => notify.success(t('common.saved')),
              onError: (e) => notify.error(t('common.error'), e.message),
            },
          )
        }
      >
        {t('common.save')}
      </Button>
    </div>
  );
}
