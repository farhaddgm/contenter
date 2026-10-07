import { useState } from 'react';
import { Mail, Send, Webhook } from 'lucide-react';
import {
  NotificationEvent,
  WEBHOOK_SECRET_MIN,
  type NotificationSettings,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/format';
import {
  useNotificationDeliveries,
  useNotificationSettings,
  useSendNotificationTest,
  useUpdateNotificationSettings,
  type NotificationTestResult,
} from '../api/inbox';

function Deliveries() {
  const t = useT();
  const { data } = useNotificationDeliveries();
  if (!data?.items.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('inbox.settings.deliveries')}</p>
      <ul className="divide-y rounded-lg border text-sm">
        {data.items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <Badge tone={d.status === 'SENT' ? 'success' : 'danger'}>
              {t(`inbox.settings.status.${d.status}`)}
            </Badge>
            <span className="text-xs text-muted-foreground">{d.channel}</span>
            <span className="min-w-0 flex-1 truncate" dir="ltr">
              {d.target}
            </span>
            <span className="text-xs text-muted-foreground">{t(`inbox.events.${d.event}`)}</span>
            {d.error && (
              <span className="w-full text-xs text-destructive" dir="ltr">
                {d.error}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{formatRelative(d.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mounted once the settings are loaded, so the form starts from them without a reset effect. */
function Form({ initial }: { initial: NotificationSettings }) {
  const t = useT();
  const save = useUpdateNotificationSettings();
  const test = useSendNotificationTest();
  const [url, setUrl] = useState(initial.webhookUrl ?? '');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [events, setEvents] = useState<string[]>(initial.webhookEvents);
  const [result, setResult] = useState<NotificationTestResult | null>(null);

  const secretTooShort = secret.length > 0 && secret.length < WEBHOOK_SECRET_MIN;
  const toggle = (e: string) =>
    setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  const outcome = (r: 'sent' | 'skipped' | { error: string }) =>
    r === 'sent' ? (
      <Badge tone="success">{t('inbox.settings.test.sent')}</Badge>
    ) : r === 'skipped' ? (
      <Badge tone="neutral">{t('inbox.settings.test.skipped')}</Badge>
    ) : (
      <span className="text-xs text-destructive" dir="ltr">
        {r.error}
      </span>
    );

  return (
    <CardBody className="space-y-6">
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mail className="size-4" />
          {t('inbox.settings.email')}
          <Badge tone={initial.emailConfigured ? 'success' : 'neutral'}>
            {initial.emailConfigured
              ? t('inbox.settings.configured')
              : t('inbox.settings.notConfigured')}
          </Badge>
        </p>
        {!initial.emailConfigured && (
          <p className="text-xs leading-6 text-muted-foreground">{t('inbox.settings.emailHint')}</p>
        )}
      </div>

      <div className="space-y-4 border-t pt-5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Webhook className="size-4" />
          {t('inbox.settings.webhook')}
        </p>
        <p className="text-xs leading-6 text-muted-foreground">{t('inbox.settings.webhookHint')}</p>
        <Field label={t('inbox.settings.url')} hint={t('inbox.settings.urlHint')}>
          {(id) => (
            <Input
              id={id}
              type="url"
              dir="ltr"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('inbox.settings.secret')}
          hint={
            initial.hasWebhookSecret && !clearSecret
              ? t('inbox.settings.secretSet')
              : t('inbox.settings.secretHint', { min: WEBHOOK_SECRET_MIN })
          }
          error={
            secretTooShort
              ? t('inbox.settings.secretShort', { min: WEBHOOK_SECRET_MIN })
              : undefined
          }
        >
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={secret}
                placeholder={initial.hasWebhookSecret && !clearSecret ? '••••••••••••••••' : ''}
                onChange={(e) => setSecret(e.target.value)}
              />
              {initial.hasWebhookSecret && (
                <Button
                  type="button"
                  variant={clearSecret ? 'secondary' : 'outline'}
                  onClick={() => setClearSecret((v) => !v)}
                >
                  {clearSecret ? t('inbox.settings.keepSecret') : t('inbox.settings.removeSecret')}
                </Button>
              )}
            </div>
          )}
        </Field>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('inbox.settings.events')}</p>
          <div className="flex flex-wrap gap-1.5">
            {NotificationEvent.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={events.includes(e)}
                onClick={() => toggle(e)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  events.includes(e)
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`inbox.events.${e}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          isLoading={save.isPending}
          disabled={secretTooShort}
          onClick={() =>
            save.mutate(
              {
                webhookUrl: url.trim() || null,
                webhookEvents: events as NotificationSettings['webhookEvents'],
                // omitted keeps the stored secret; null removes it
                ...(secret
                  ? { webhookSecret: secret }
                  : clearSecret
                    ? { webhookSecret: null }
                    : {}),
              },
              {
                onSuccess: () => {
                  setSecret('');
                  setClearSecret(false);
                  notify.success(t('common.saved'));
                },
                onError: (e) => notify.error(t('common.error'), e.message),
              },
            )
          }
        >
          {t('common.save')}
        </Button>
        <Button
          variant="outline"
          icon={<Send />}
          isLoading={test.isPending}
          onClick={() =>
            test.mutate(undefined, {
              onSuccess: setResult,
              onError: (e) => notify.error(t('common.error'), e.message),
            })
          }
        >
          {t('inbox.settings.sendTest')}
        </Button>
      </div>
      {result && (
        <dl className="space-y-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt>{t('inbox.settings.email')}</dt>
            <dd>{outcome(result.email)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>{t('inbox.settings.webhook')}</dt>
            <dd>{outcome(result.webhook)}</dd>
          </div>
        </dl>
      )}
      <Deliveries />
    </CardBody>
  );
}

/** The system-wide channels: the status of e-mail and the outgoing webhook (admins only). */
export function NotificationSettingsCard() {
  const t = useT();
  const { data } = useNotificationSettings();
  return (
    <Card>
      <CardHeader title={t('inbox.settings.title')} description={t('inbox.settings.subtitle')} />
      {data ? <Form initial={data} /> : <Spinner />}
    </Card>
  );
}
