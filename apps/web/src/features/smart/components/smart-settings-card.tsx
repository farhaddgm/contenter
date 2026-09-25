import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { SmartSettings } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useSmartSettings, useUpdateSmartSettings } from '../api';

function Form({ initial }: { initial: SmartSettings }) {
  const t = useT();
  const save = useUpdateSmartSettings();
  const [form, setForm] = useState(initial);
  return (
    <CardBody className="space-y-4">
      <p className="text-sm leading-7 text-muted-foreground">{t('smart.settings.description')}</p>
      <Switch
        checked={form.detailedLogging}
        onCheckedChange={(detailedLogging) => setForm({ ...form, detailedLogging })}
        label={<span className="font-medium">{t('smart.settings.detailedLogging')}</span>}
      />
      <div className="max-w-48">
        <Field label={t('smart.settings.retentionDays')}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={365}
              value={form.retentionDays}
              onChange={(e) =>
                setForm({
                  ...form,
                  retentionDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                })
              }
            />
          )}
        </Field>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> {t('smart.settings.privacy')}
      </p>
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
    </CardBody>
  );
}

/** Settings card for the opt-in detailed interaction logging (default: off). */
export function SmartSettingsCard() {
  const t = useT();
  const { data, isLoading } = useSmartSettings();
  return (
    <Card>
      <CardHeader title={t('smart.settings.title')} />
      {isLoading || !data ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : (
        <Form initial={data} />
      )}
    </Card>
  );
}
