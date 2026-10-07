import { BellRing, MailWarning } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useNotificationPreferences, useSetNotificationPreference } from '../api/inbox';

/** What the user is told about, per event: in the app and by e-mail. */
export function NotificationPreferencesCard() {
  const t = useT();
  const { data } = useNotificationPreferences();
  const set = useSetNotificationPreference();
  const change = (
    event: Parameters<typeof set.mutate>[0]['event'],
    patch: { inApp?: boolean; email?: boolean },
  ) =>
    set.mutate({ event, ...patch }, { onError: (e) => notify.error(t('common.error'), e.message) });

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BellRing className="size-4" />
            {t('inbox.preferences.title')}
          </span>
        }
        description={t('inbox.preferences.subtitle')}
      />
      <CardBody className="space-y-4">
        {!data ? (
          <Spinner />
        ) : (
          <>
            {!data.emailAvailable && (
              <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs leading-6 text-muted-foreground">
                <MailWarning className="mt-1 size-4 shrink-0" />
                {t('inbox.preferences.noEmail')}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('inbox.preferences.event')}</th>
                    <th className="px-3 py-2 text-center font-medium">
                      {t('inbox.preferences.inApp')}
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      {t('inbox.preferences.email')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.preferences.map((p) => (
                    <tr key={p.event} className="border-b last:border-0">
                      <td className="py-2.5">
                        <p className="font-medium">{t(`inbox.events.${p.event}`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`inbox.eventHints.${p.event}`)}
                        </p>
                      </td>
                      <td className="px-3 text-center">
                        <Switch
                          checked={p.inApp}
                          onCheckedChange={(inApp) => change(p.event, { inApp })}
                        />
                      </td>
                      <td className="px-3 text-center">
                        <Switch
                          checked={p.email}
                          disabled={!data.emailAvailable}
                          onCheckedChange={(email) => change(p.event, { email })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
