import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Link2Off, Plug, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { formatDate } from '@/utils/format';
import { useConnectDrive, useDisconnectDrive, useDriveStatus } from '../api/businesses';

const RESULTS = [
  'connected',
  'cancelled',
  'expired',
  'no_drive_permission',
  'no_refresh_token',
  'not_configured',
  'failed',
] as const;
type Result = (typeof RESULTS)[number];

/**
 * Shows the outcome of the Google consent round trip (`?drive=…` added by the API callback)
 * once, then cleans the URL. Call it on every page a connect can return to.
 */
export function useDriveResultNotice() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const result = params.get('drive');
  const account = params.get('account') ?? '';

  useEffect(() => {
    if (!result) return;
    const code: Result = (RESULTS as readonly string[]).includes(result)
      ? (result as Result)
      : 'failed';
    if (code === 'connected') notify.success(t('businesses.drive.result.connected', { account }));
    else notify.error(t(`businesses.drive.result.${code}`));
    setParams(
      (prev) => {
        prev.delete('drive');
        prev.delete('account');
        return prev;
      },
      { replace: true },
    );
  }, [result, account, setParams, t]);
}

/** Button that sends the admin to Google and back to the current page. */
export function ConnectDriveButton({ another = false }: { another?: boolean }) {
  const t = useT();
  const location = useLocation();
  const connect = useConnectDrive();
  return (
    <Button
      size="sm"
      variant="outline"
      icon={<Plug />}
      isLoading={connect.isPending}
      onClick={() =>
        connect.mutate(`${location.pathname}${location.search}`, {
          onError: (e) => notify.error(t('common.error'), e.message),
        })
      }
    >
      {another ? t('businesses.drive.connectAnother') : t('businesses.drive.connect')}
    </Button>
  );
}

/** Connected Google accounts used to read private Google Docs (Settings page). */
export function GoogleDriveCard() {
  const t = useT();
  const { can } = useAuthorization();
  const admin = can('backoffice:access');
  const { data, isLoading } = useDriveStatus();
  const disconnect = useDisconnectDrive();
  useDriveResultNotice();

  return (
    <Card>
      <CardHeader
        title={t('businesses.drive.title')}
        description={t('businesses.drive.subtitle')}
        actions={
          admin && data?.configured && <ConnectDriveButton another={data.accounts.length > 0} />
        }
      />
      <CardBody className="space-y-3 text-sm">
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <>
            {!data.configured && (
              <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs leading-6">
                <TriangleAlert className="mt-1 size-4 shrink-0 text-warning" />
                {t('businesses.drive.notConfigured')}
              </p>
            )}
            {data.accounts.length === 0 ? (
              <p className="text-muted-foreground">{t('businesses.drive.empty')}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.accounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" dir="ltr">
                        {a.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.error
                          ? a.error
                          : a.lastUsedAt
                            ? t('businesses.drive.lastUsed', { date: formatDate(a.lastUsedAt) })
                            : formatDate(a.createdAt)}
                      </p>
                    </div>
                    {a.error && <Badge tone="danger">{t('businesses.drive.needsReconnect')}</Badge>}
                    {admin && (
                      <ConfirmationDialog
                        title={t('businesses.drive.disconnect')}
                        body={t('businesses.drive.disconnectBody', { email: a.email })}
                        confirmLabel={t('businesses.drive.disconnect')}
                        isLoading={disconnect.isPending}
                        trigger={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t('businesses.drive.disconnect')}
                            title={t('businesses.drive.disconnect')}
                          >
                            <Link2Off />
                          </Button>
                        }
                        onConfirm={() =>
                          disconnect
                            .mutateAsync(a.id)
                            .then(() => notify.success(t('businesses.drive.disconnected')))
                            .catch((e: Error) => notify.error(t('common.error'), e.message))
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.redirectUri && (
              <p className="text-xs leading-6 text-muted-foreground">
                {t('businesses.drive.redirectHint')}{' '}
                <code className="break-all rounded bg-muted px-1.5 py-0.5" dir="ltr">
                  {data.redirectUri}
                </code>
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
