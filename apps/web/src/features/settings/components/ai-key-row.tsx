import { useState } from 'react';
import { AiKeyInputSchema, type AiProviderName, type AiProviderStatus } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useSetAiKey } from '@/features/admin/api';

/** One vendor in the providers card: status, and a write-only field for its API key (docs/62). */
export function AiKeyRow({ status, label }: { status: AiProviderStatus; label: string }) {
  const t = useT();
  const save = useSetAiKey();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const name: AiProviderName = status.name;
  const parsed = AiKeyInputSchema.safeParse({ provider: name, key: value });

  const send = (key: string | null) =>
    save.mutate(
      { provider: name, key },
      {
        onSuccess: () => {
          notify.success(t('common.saved'));
          setValue('');
          setEditing(false);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <li className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Badge tone={status.configured ? 'success' : 'neutral'}>
          {status.configured ? t('settings.connected') : t('settings.noKey')}
        </Badge>
      </div>
      {status.configured && (
        <p className="text-xs text-muted-foreground">
          {status.keySource === 'database'
            ? t('settings.keySaved', { vars: status.keyHint ?? '' })
            : t('settings.keyFromEnv')}
        </p>
      )}
      {editing ? (
        <div className="flex gap-2">
          <Input
            dir="ltr"
            type="password"
            autoComplete="off"
            aria-label={`${label} — ${t('settings.apiKey')}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-…"
          />
          <Button
            size="sm"
            isLoading={save.isPending}
            disabled={!parsed.success}
            onClick={() => send(value.trim())}
          >
            {t('common.save')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue('');
              setEditing(false);
            }}
          >
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {status.keySource === 'database' ? t('settings.replaceKey') : t('settings.setKey')}
          </Button>
          {status.keySource === 'database' && (
            <Button
              size="sm"
              variant="ghost"
              isLoading={save.isPending}
              onClick={() => send(null)}
            >
              {t('settings.removeKey')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
