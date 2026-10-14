import { useState } from 'react';
import { Plus, Tags, Trash2 } from 'lucide-react';
import {
  PILLAR_MAX,
  PILLAR_NAME_MAX,
  SavePillarsSchema,
  type ContentPillar,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useCanEditBusiness } from '@/features/businesses/api/businesses';
import { usePillars, useSavePillars } from '../api/coverage';

interface Draft {
  id?: string;
  name: string;
  /** Percent as typed; empty = no target. */
  target: string;
}

/** The content pillars of a business and their wanted shares (docs/50). */
export function PillarsCard({ businessId }: { businessId: string }) {
  const t = useT();
  const { data, isLoading } = usePillars(businessId);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Tags className="size-4" />
            {t('coverage.pillars.title')}
          </span>
        }
        description={t('coverage.pillars.hint', { max: PILLAR_MAX })}
      />
      {isLoading || !data ? (
        <CardBody className="flex justify-center py-6">
          <Spinner />
        </CardBody>
      ) : (
        // keyed by what is saved, so a save (or another editor's change) resets the form without an effect
        <PillarsForm key={JSON.stringify(data)} businessId={businessId} saved={data} />
      )}
    </Card>
  );
}

function PillarsForm({ businessId, saved }: { businessId: string; saved: ContentPillar[] }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const save = useSavePillars(businessId);
  const [rows, setRows] = useState<Draft[]>(
    saved.map((p) => ({
      id: p.id,
      name: p.name,
      target: p.targetShare === null ? '' : String(p.targetShare),
    })),
  );
  const patch = (i: number, p: Partial<Draft>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...p } : r)));

  const pillars = rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name: r.name.trim(),
      targetShare: r.target.trim() === '' ? null : Number(r.target),
    }));
  const parsed = SavePillarsSchema.safeParse({ pillars });

  return (
    <CardBody className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('coverage.pillars.empty')}</p>
      )}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className="flex items-center gap-2">
            <Input
              aria-label={t('coverage.pillars.name')}
              value={r.name}
              maxLength={PILLAR_NAME_MAX}
              disabled={!canEdit}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <Input
              aria-label={t('coverage.pillars.target')}
              className="w-24"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              placeholder="٪"
              value={r.target}
              disabled={!canEdit}
              onChange={(e) => patch(i, { target: e.target.value })}
            />
            {canEdit && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.delete')}
                icon={<Trash2 />}
                onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}
              />
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<Plus />}
            disabled={rows.length >= PILLAR_MAX}
            onClick={() => setRows((rs) => [...rs, { name: '', target: '' }])}
          >
            {t('coverage.pillars.add')}
          </Button>
          <Button
            size="sm"
            isLoading={save.isPending}
            disabled={!parsed.success}
            onClick={() =>
              parsed.success &&
              save.mutate(parsed.data, {
                onSuccess: () => notify.success(t('common.saved')),
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            {t('common.save')}
          </Button>
          {!parsed.success && (
            <span className="text-xs text-destructive">{t('coverage.pillars.invalid')}</span>
          )}
        </div>
      )}
    </CardBody>
  );
}
