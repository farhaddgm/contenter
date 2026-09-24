import { useState } from 'react';
import { Bot, CheckCircle2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Switch, Textarea } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';
import {
  useActivatePrompt,
  useCreatePromptVersion,
  usePromptKeys,
  usePromptVersions,
} from '@/features/admin/api';

function NewVersionDrawer({
  promptKey,
  base,
  open,
  onOpenChange,
}: {
  promptKey: string;
  base?: { system: string; user: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreatePromptVersion(promptKey);
  const [system, setSystem] = useState(base?.system ?? '');
  const [user, setUser] = useState(base?.user ?? '');
  const [notes, setNotes] = useState('');
  const [activate, setActivate] = useState(true);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('prompts.newVersion')} — ${promptKey}`}
      className="max-w-4xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            isLoading={create.isPending}
            disabled={system.length < 10 || user.length < 10}
            onClick={() =>
              create.mutate(
                { system, user, notes, activate },
                {
                  onSuccess: () => {
                    notify.success(t('common.saved'));
                    onOpenChange(false);
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('prompts.system')}>
          {(id) => (
            <Textarea
              id={id}
              dir="ltr"
              rows={14}
              className="font-mono text-xs"
              value={system}
              onChange={(e) => setSystem(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('prompts.user')}>
          {(id) => (
            <Textarea
              id={id}
              dir="ltr"
              rows={12}
              className="font-mono text-xs"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('prompts.notes')}>
          {(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <Switch
          checked={activate}
          onCheckedChange={setActivate}
          label={t('prompts.activateOnSave')}
        />
      </div>
    </Drawer>
  );
}

export default function PromptsRoute() {
  const t = useT();
  const keys = usePromptKeys();
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const current = selected ?? keys.data?.[0]?.key ?? null;
  const versions = usePromptVersions(current);
  const activate = useActivatePrompt(current ?? '');
  // A picked version only applies to the prompt key it was picked for.
  const [picked, setPicked] = useState<{ key: string; version: number } | null>(null);
  const viewVersion = picked?.key === current ? picked.version : null;
  const setViewVersion = (version: number) => current && setPicked({ key: current, version });

  if (keys.isLoading) return <PageSpinner />;
  const meta = keys.data?.find((k) => k.key === current);
  const shown =
    versions.data?.find((v) => v.version === viewVersion) ??
    versions.data?.find((v) => v.isActive) ??
    versions.data?.[0];

  return (
    <>
      <PageHeader title={t('prompts.title')} description={t('prompts.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit p-2">
          {keys.data?.map((k) => (
            <button
              key={k.key}
              onClick={() => setSelected(k.key)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-3 py-2.5 text-start text-sm transition',
                k.key === current ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              <span className="flex items-center gap-2 font-medium" dir="ltr">
                <Bot className="size-4" />
                {k.key}
              </span>
              <Badge tone={k.activeVersion ? 'success' : 'neutral'}>v{k.activeVersion ?? 0}</Badge>
            </button>
          ))}
        </Card>
        {meta && (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={<span dir="ltr">{meta.key}</span>}
                description={meta.notes}
                actions={
                  <Button icon={<Plus />} onClick={() => setDrawerOpen(true)}>
                    {t('prompts.newVersion')}
                  </Button>
                }
              />
              <CardBody className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('prompts.variables')}:</span>
                {meta.variables.map((v) => (
                  <code
                    key={v}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    dir="ltr"
                  >{`{{${v}}}`}</code>
                ))}
              </CardBody>
            </Card>
            {!versions.data?.length ? (
              <Card>
                <EmptyState title={t('prompts.builtIn')} />
              </Card>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[12rem_1fr]">
                <Card className="h-fit p-2">
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {t('prompts.versions')}
                  </p>
                  {versions.data.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setViewVersion(v.version)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-3 py-2 text-start text-sm',
                        v.id === shown?.id ? 'bg-accent' : 'hover:bg-muted',
                      )}
                    >
                      <span>
                        <span className="block font-medium">v{formatNumber(v.version)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDate(v.createdAt, false)}
                        </span>
                      </span>
                      {v.isActive && <CheckCircle2 className="size-4 text-success" />}
                    </button>
                  ))}
                </Card>
                {shown && (
                  <Card>
                    <CardHeader
                      title={`v${formatNumber(shown.version)}`}
                      description={shown.notes || undefined}
                      actions={
                        !shown.isActive && (
                          <Button
                            size="sm"
                            isLoading={activate.isPending}
                            onClick={() =>
                              activate.mutate(shown.version, {
                                onSuccess: () => notify.success(t('prompts.activated')),
                              })
                            }
                          >
                            {t('prompts.activate')}
                          </Button>
                        )
                      }
                    />
                    <CardBody className="space-y-4">
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t('prompts.system')}
                        </p>
                        <pre
                          dir="ltr"
                          className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-start text-xs leading-5"
                        >
                          {shown.system}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t('prompts.user')}
                        </p>
                        <pre
                          dir="ltr"
                          className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-start text-xs leading-5"
                        >
                          {shown.user}
                        </pre>
                      </div>
                    </CardBody>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {current && drawerOpen && (
        <NewVersionDrawer promptKey={current} base={shown} open onOpenChange={setDrawerOpen} />
      )}
    </>
  );
}
