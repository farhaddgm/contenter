import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { Link2Off, Plug, TriangleAlert, Users } from 'lucide-react';
import type { GoogleDriveAccount } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/form-controls';
import { CopyButton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { formatDate } from '@/utils/format';
import { api } from '@/lib/api-client';
import {
  businessKeys,
  useBusinessOptions,
  useConnectDrive,
  useDisconnectDrive,
  useDriveStatus,
} from '../api/businesses';

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

/** Which businesses a connected account may read (docs/77). */
function useUpdateDriveScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; allBusinesses: boolean; businessIds: string[] }) =>
      api.patch(`/google-drive/accounts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: businessKeys.drive }),
  });
}

/** Choose "all businesses" or a list for one account. Mounted only while open. */
function ScopeDialog({
  account,
  onOpenChange,
}: {
  account: GoogleDriveAccount;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const { data: options } = useBusinessOptions();
  const save = useUpdateDriveScope();
  const [all, setAll] = useState(account.allBusinesses);
  const [ids, setIds] = useState(new Set(account.businessIds));
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.drive.scopeTitle')}
      description={account.email}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            isLoading={save.isPending}
            onClick={() =>
              save.mutate(
                { id: account.id, allBusinesses: all, businessIds: [...ids] },
                {
                  onSuccess: () => {
                    notify.success(t('businesses.drive.scopeSaved'));
                    onOpenChange(false);
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('businesses.drive.scopeSave')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={all} onCheckedChange={setAll} />
          {t('businesses.drive.scopeAllLabel')}
        </label>
        {!all && (
          <>
            <ul className="max-h-64 divide-y overflow-auto rounded-md border">
              {(options ?? []).map((b) => (
                <li key={b.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={ids.has(b.id)}
                      onChange={(e) =>
                        setIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(b.id);
                          else next.delete(b.id);
                          return next;
                        })
                      }
                    />
                    <span data-bidi="">{b.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {ids.size === 0 && (
              <p className="text-xs leading-6 text-muted-foreground">
                {t('businesses.drive.scopeEmpty')}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The address a document is shared with so the server can read it (docs/77). */
function ServiceAccountBox({ email }: { email: string | null }) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-md bg-primary/5 px-3 py-2 text-xs leading-6">
      <p className="font-medium">{t('businesses.drive.serviceAccountTitle')}</p>
      {email ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-1.5 py-0.5" dir="ltr">
              {email}
            </code>
            <CopyButton text={email} />
          </p>
          <p className="text-muted-foreground">{t('businesses.drive.serviceAccountHint')}</p>
        </>
      ) : (
        <p className="text-muted-foreground">{t('businesses.drive.serviceAccountOff')}</p>
      )}
    </div>
  );
}

/** Connected Google accounts used to read private Google Docs (Settings page). */
export function GoogleDriveCard() {
  const t = useT();
  const { can } = useAuthorization();
  const admin = can('backoffice:access');
  const { data, isLoading } = useDriveStatus();
  const disconnect = useDisconnectDrive();
  const [scoping, setScoping] = useState<GoogleDriveAccount | null>(null);
  useDriveResultNotice();

  return (
    <Card>
      <CardHeader
        title={t('businesses.drive.title')}
        description={t('businesses.drive.subtitle')}
        descriptionAsTip
        actions={
          admin && data?.configured && <ConnectDriveButton another={data.accounts.length > 0} />
        }
      />
      <CardBody className="space-y-3 text-sm">
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <>
            <ServiceAccountBox email={data.serviceAccountEmail} />
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
                    <Badge>
                      {a.allBusinesses
                        ? t('businesses.drive.scopeAll')
                        : t('businesses.drive.scopeSome', { count: a.businessIds.length })}
                    </Badge>
                    {admin && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('businesses.drive.scope')}
                        title={t('businesses.drive.scope')}
                        onClick={() => setScoping(a)}
                      >
                        <Users />
                      </Button>
                    )}
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
      {scoping && <ScopeDialog account={scoping} onOpenChange={(v) => !v && setScoping(null)} />}
    </Card>
  );
}
