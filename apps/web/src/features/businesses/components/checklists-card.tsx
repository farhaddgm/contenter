import { useState } from 'react';
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import {
  CHECKLIST_MAX_ITEMS,
  Platform,
  type ChecklistItem,
  type ChecklistTemplate,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Select, Switch } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useCanEditBusiness } from '../api/businesses';
import { useChecklists, useSaveChecklists } from '../api/checklists';

/** What the form edits: a list of templates, each with points that may not have an id yet. */
interface Draft {
  platform: Platform | null;
  items: (Omit<ChecklistItem, 'id'> & { id?: string })[];
}

const keyOf = (p: Platform | null) => p ?? 'ALL';

/**
 * The publishing checklist of a business (docs/45): points people must confirm before a content is
 * scheduled, for every platform or for one. A required point stops scheduling until it is ticked.
 */
export function ChecklistsCard({ businessId }: { businessId: string }) {
  const t = useT();
  const { data, isLoading } = useChecklists(businessId);
  if (isLoading || !data) {
    return (
      <Card>
        <CardBody className="flex justify-center py-8">
          <Spinner />
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ClipboardCheck className="size-4" />
            {t('businesses.checklists.title')}
          </span>
        }
        description={t('businesses.checklists.hint')}
      />
      {/* keyed by what is saved, so a save (or another editor's change) resets the form without an effect */}
      <ChecklistsForm key={JSON.stringify(data)} businessId={businessId} saved={data} />
    </Card>
  );
}

function ChecklistsForm({ businessId, saved }: { businessId: string; saved: ChecklistTemplate[] }) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const save = useSaveChecklists(businessId);
  const [drafts, setDrafts] = useState<Draft[]>(() => saved.map((s) => ({ ...s })));
  const [adding, setAdding] = useState('');

  const change = (index: number, items: Draft['items']) =>
    setDrafts((all) => all.map((d, i) => (i === index ? { ...d, items } : d)));
  const used = new Set(drafts.map((d) => keyOf(d.platform)));
  const addable = [
    ...(used.has('ALL') ? [] : [{ value: 'ALL', label: t('businesses.checklists.allPlatforms') }]),
    ...Platform.filter((p) => !used.has(p)).map((p) => ({
      value: p,
      label: t(`enums.platform.${p}`),
    })),
  ];

  const onSave = () =>
    save.mutate(
      {
        templates: drafts
          .map((d) => ({
            platform: d.platform,
            items: d.items
              .map((i) => ({ ...i, text: i.text.trim() }))
              .filter((i) => i.text.length > 0),
          }))
          .filter((d) => d.items.length > 0),
      },
      {
        onSuccess: () => notify.success(t('businesses.checklists.saved')),
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <CardBody className="space-y-5">
      {drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('businesses.checklists.empty')}</p>
      )}
      {drafts.map((d, index) => (
        <section key={keyOf(d.platform)} className="space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">
            {d.platform
              ? t('businesses.checklists.forPlatform', {
                  platform: t(`enums.platform.${d.platform}`),
                })
              : t('businesses.checklists.allPlatforms')}
          </h3>
          <ul className="space-y-2">
            {d.items.map((item, i) => (
              <li key={item.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-48 flex-1"
                  value={item.text}
                  maxLength={160}
                  disabled={!canEdit}
                  aria-label={t('businesses.checklists.point')}
                  onChange={(e) =>
                    change(
                      index,
                      d.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                    )
                  }
                />
                <Switch
                  label={t('businesses.checklists.required')}
                  checked={item.required}
                  disabled={!canEdit || !!item.auto}
                  onCheckedChange={(v) =>
                    change(
                      index,
                      d.items.map((x, j) => (j === i ? { ...x, required: v } : x)),
                    )
                  }
                />
                <Switch
                  label={t('businesses.checklists.auto')}
                  checked={!!item.auto}
                  disabled={!canEdit || item.required}
                  onCheckedChange={(v) =>
                    change(
                      index,
                      d.items.map((x, j) =>
                        j === i ? { ...x, auto: v ? 'QUALITY_CLEAN' : null } : x,
                      ),
                    )
                  }
                />
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('common.delete')}
                    onClick={() =>
                      change(
                        index,
                        d.items.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && d.items.length < CHECKLIST_MAX_ITEMS && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => change(index, [...d.items, { text: '', required: false, auto: null }])}
            >
              <Plus /> {t('businesses.checklists.addPoint')}
            </Button>
          )}
        </section>
      ))}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {addable.length > 0 && (
            <>
              <Select
                aria-label={t('businesses.checklists.addFor')}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                options={[{ value: '', label: t('businesses.checklists.addFor') }, ...addable]}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!adding}
                onClick={() => {
                  setDrafts((all) => [
                    ...all,
                    {
                      platform: adding === 'ALL' ? null : (adding as Platform),
                      items: [{ text: '', required: false, auto: null }],
                    },
                  ]);
                  setAdding('');
                }}
              >
                <Plus /> {t('businesses.checklists.addChecklist')}
              </Button>
            </>
          )}
          <Button size="sm" onClick={onSave} isLoading={save.isPending} className="ms-auto">
            {t('common.save')}
          </Button>
        </div>
      )}
    </CardBody>
  );
}
