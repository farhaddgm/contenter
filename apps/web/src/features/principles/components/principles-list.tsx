import { useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { PrincipleKind, type Principle } from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import {
  useCreatePrinciple,
  useDeletePrinciple,
  usePrinciples,
  useUpdatePrinciple,
} from '@/features/topics/api/topics';

const kindTone: Record<Principle['kind'], BadgeTone> = {
  MUST: 'success',
  AVOID: 'danger',
  PREFER: 'primary',
};

/** Manage principles of a topic, or global principles when topicId is null. */
export function PrinciplesList({
  topicId,
  title,
  description,
}: {
  topicId: string | null;
  title: string;
  description?: string;
}) {
  const t = useT();
  const { can } = useAuthorization();
  const editable = topicId ? can('content:write') : can('backoffice:access');
  const { data, isLoading } = usePrinciples(topicId);
  const create = useCreatePrinciple(topicId);
  const update = useUpdatePrinciple(topicId);
  const remove = useDeletePrinciple(topicId);
  const [kind, setKind] = useState<Principle['kind']>('MUST');
  const [text, setText] = useState('');

  const add = () => {
    if (text.trim().length < 3) return;
    create.mutate(
      { kind, text: text.trim(), order: data?.length ?? 0 },
      { onSuccess: () => setText(''), onError: (e) => notify.error(t('common.error'), e.message) },
    );
  };

  return (
    <Card>
      <CardHeader title={title} description={description} />
      {editable && (
        <div className="flex flex-col gap-3 border-b bg-muted/30 p-4 sm:flex-row sm:items-start">
          <div className="sm:w-36">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as Principle['kind'])}
              options={PrincipleKind.map((k) => ({
                value: k,
                label: t(`enums.principleKind.${k}`),
              }))}
            />
          </div>
          <Textarea
            rows={2}
            className="flex-1"
            placeholder={t('principles.text')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
            }}
          />
          <Button
            icon={<Plus />}
            onClick={add}
            isLoading={create.isPending}
            disabled={text.trim().length < 3}
          >
            {t('principles.add')}
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : !data?.length ? (
        <EmptyState icon={<ShieldCheck />} title={t('principles.empty')} />
      ) : (
        <ul className="divide-y">
          {data.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-5 py-3.5">
              <Badge tone={kindTone[p.kind]} className="mt-0.5 shrink-0">
                {t(`enums.principleKind.${p.kind}`)}
              </Badge>
              <p
                className={`flex-1 text-sm leading-7 ${p.isActive ? '' : 'text-muted-foreground line-through'}`}
              >
                {p.text}
              </p>
              {editable && (
                <div className="flex shrink-0 items-center gap-3">
                  <Switch
                    checked={p.isActive}
                    onCheckedChange={(v) => update.mutate({ id: p.id, data: { isActive: v } })}
                  />
                  <ConfirmationDialog
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')}>
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    }
                    onConfirm={() => remove.mutateAsync(p.id)}
                    isLoading={remove.isPending}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
