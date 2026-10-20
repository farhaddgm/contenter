import { useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import {
  API_KEY_DEFAULT_DAYS,
  API_KEY_MAX_ACTIVE,
  API_KEY_MAX_DAYS,
  API_KEY_UNUSED_WARN_DAYS,
  CreateApiKeySchema,
  apiKeyStatus,
  isApiKeyUnused,
  scopesAllowedFor,
  type ApiKeyInfo,
  type ApiKeyScope,
  type CreatedApiKey,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Switch } from '@/components/ui/form-controls';
import { CopyButton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber, formatRelative } from '@/utils/format';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '../api/api-keys';

/**
 * The person's personal API keys (docs/52-api-keys.md). The whole key is shown once, right after
 * it is made; after that only its prefix is. A key can read and queue drafts through `/api/v1`
 * but can never review, approve, schedule or publish.
 */
export function ApiKeysCard() {
  const t = useT();
  const { data, isLoading } = useApiKeys();
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const active = data?.filter((k) => apiKeyStatus(k) === 'ACTIVE').length ?? 0;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t('apiKeys.title')}
          </span>
        }
        description={t('apiKeys.subtitle', { max: formatNumber(API_KEY_MAX_ACTIVE) })}
        descriptionAsTip
        actions={
          <Button
            size="sm"
            icon={<Plus />}
            disabled={active >= API_KEY_MAX_ACTIVE}
            onClick={() => setCreating(true)}
          >
            {t('apiKeys.create')}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {isLoading || !data ? (
          <Spinner />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('apiKeys.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {data.map((k) => (
              <KeyRow
                key={k.id}
                k={k}
                onRevoke={() =>
                  revoke.mutateAsync(k.id, {
                    onSuccess: () => notify.success(t('apiKeys.revoked')),
                    onError: (e) => notify.error(t('common.error'), e.message),
                  })
                }
              />
            ))}
          </ul>
        )}
        <p className="text-xs leading-5 text-muted-foreground">{t('apiKeys.limits')}</p>
      </CardBody>
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false);
            setCreated(k);
          }}
        />
      )}
      {created && <ShownOnce created={created} onClose={() => setCreated(null)} />}
    </Card>
  );
}

function KeyRow({ k, onRevoke }: { k: ApiKeyInfo; onRevoke: () => Promise<unknown> }) {
  const t = useT();
  const status = apiKeyStatus(k);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
      <span className="font-medium" dir="auto">
        {k.name}
      </span>
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs" dir="ltr">
        {k.prefix}…
      </code>
      <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>
        {t(`apiKeys.status.${status}`)}
      </Badge>
      {isApiKeyUnused(k) && (
        <Badge tone="warning">
          {t('apiKeys.unused', { n: formatNumber(API_KEY_UNUSED_WARN_DAYS) })}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground" dir="ltr">
        {k.scopes.join(' · ')}
      </span>
      <span className="ms-auto text-xs text-muted-foreground">
        {k.lastUsedAt
          ? t('apiKeys.lastUsed', { when: formatRelative(k.lastUsedAt) })
          : t('apiKeys.neverUsed')}
        {' · '}
        {t('apiKeys.expires', { when: formatDate(k.expiresAt, false) })}
      </span>
      {status === 'ACTIVE' && (
        <ConfirmationDialog
          title={t('apiKeys.revokeTitle')}
          body={t('apiKeys.revokeBody', { name: k.name })}
          confirmLabel={t('apiKeys.revoke')}
          trigger={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('apiKeys.revoke')}
              icon={<Trash2 />}
            />
          }
          onConfirm={onRevoke}
        />
      )}
    </li>
  );
}

/** Mounted only while open, so the form starts empty every time without an effect. */
function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (k: CreatedApiKey) => void;
}) {
  const t = useT();
  const role = useUser()?.role ?? 'VIEWER';
  const allowed = scopesAllowedFor(role);
  const create = useCreateApiKey();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['contents:read']);
  const [days, setDays] = useState(String(API_KEY_DEFAULT_DAYS));

  const parsed = CreateApiKeySchema.safeParse({ name, scopes, expiresInDays: Number(days) });
  const toggle = (s: ApiKeyScope, on: boolean) =>
    setScopes((cur) => (on ? [...cur, s] : cur.filter((x) => x !== s)));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('apiKeys.create')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            isLoading={create.isPending}
            disabled={!parsed.success}
            onClick={() =>
              parsed.success &&
              create.mutate(parsed.data, {
                onSuccess: onCreated,
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            {t('apiKeys.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('apiKeys.name')} hint={t('apiKeys.nameHint')}>
          {(id) => (
            <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('apiKeys.scopes')}</legend>
          {allowed.map((s) => (
            <div key={s}>
              <Switch
                checked={scopes.includes(s)}
                onCheckedChange={(on) => toggle(s, on)}
                label={
                  <span>
                    <code dir="ltr" className="text-xs">
                      {s}
                    </code>
                    <span className="ms-2 text-muted-foreground">
                      {t(`apiKeys.scopeHelp.${s}`)}
                    </span>
                  </span>
                }
              />
            </div>
          ))}
        </fieldset>
        <Field
          label={t('apiKeys.expiresIn')}
          hint={t('apiKeys.expiresHint', { max: formatNumber(API_KEY_MAX_DAYS) })}
          className="w-44"
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={1}
              max={API_KEY_MAX_DAYS}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function ShownOnce({ created, onClose }: { created: CreatedApiKey; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('apiKeys.createdTitle')}
      description={t('apiKeys.createdBody')}
      footer={<Button onClick={onClose}>{t('apiKeys.savedIt')}</Button>}
    >
      <div className="space-y-3">
        <code
          className="block break-all rounded-md bg-muted p-3 text-sm"
          dir="ltr"
          data-testid="new-api-key"
        >
          {created.key}
        </code>
        <CopyButton text={created.key} />
        <p className="text-xs leading-5 text-muted-foreground">{t('apiKeys.useHint')}</p>
      </div>
    </Dialog>
  );
}
