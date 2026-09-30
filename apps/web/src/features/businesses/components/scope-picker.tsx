import { useState } from 'react';
import { BookOpen, FileText, Globe, Link2, Plus, SearchCheck } from 'lucide-react';
import type { BusinessReference, ResearchScope } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { useAddReference, useReferences } from '../api/businesses';

const ICON: Record<ResearchScope, typeof Globe> = {
  NONE: FileText,
  REFERENCES: BookOpen,
  REFERENCE_SITES: SearchCheck,
  WEB: Globe,
};

export interface ScopeValue {
  scope: ResearchScope;
  /** Null = every active, readable reference. */
  referenceIds: string[] | null;
}

/** References an AI job can read right now. */
export const usableReferences = (refs: BusinessReference[] | undefined) =>
  (refs ?? []).filter((r) => r.status === 'READY' && r.isActive && r.chars > 0);

/**
 * "What may AI consult?" — the research scope of a build/suggestion. With a `businessId` it
 * also lets the admin pick which references this request uses and add one more link on the spot.
 */
export function ScopePicker({
  businessId,
  scopes,
  value,
  onChange,
  hasWebsite = false,
}: {
  businessId?: string;
  scopes: readonly ResearchScope[];
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  hasWebsite?: boolean;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t('businesses.scope.label')}</legend>
      {scopes.map((s) => {
        const Icon = ICON[s];
        return (
          <label
            key={s}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition',
              value.scope === s ? 'border-primary bg-primary/5' : 'hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name="research-scope"
              className="mt-1 accent-primary"
              checked={value.scope === s}
              onChange={() => onChange({ ...value, scope: s })}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon className="size-4 text-muted-foreground" />
                {t(`businesses.scope.${s}`)}
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {t(`businesses.scope.${s}Hint`)}
              </span>
            </span>
          </label>
        );
      })}
      {businessId && value.scope !== 'NONE' && (
        <ReferencePick
          businessId={businessId}
          value={value}
          onChange={onChange}
          hasWebsite={hasWebsite}
        />
      )}
    </fieldset>
  );
}

function ReferencePick({
  businessId,
  value,
  onChange,
  hasWebsite,
}: {
  businessId: string;
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  hasWebsite: boolean;
}) {
  const t = useT();
  const { data } = useReferences(businessId);
  const add = useAddReference(businessId);
  const [link, setLink] = useState('');
  const ready = usableReferences(data);
  const picked = new Set(value.referenceIds ?? ready.map((r) => r.id));
  const needsReference =
    value.scope === 'REFERENCES' || (value.scope === 'REFERENCE_SITES' && !hasWebsite);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...value, referenceIds: [...next] });
  };

  const addLink = () =>
    add.mutate(
      { url: link.trim() },
      {
        onSuccess: (r) => {
          setLink('');
          if (r.status !== 'READY') {
            notify.warning(t('businesses.references.addedFailed'), r.error ?? undefined);
          } else if (value.referenceIds) {
            onChange({ ...value, referenceIds: [...value.referenceIds, r.id] });
          }
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <div className="space-y-2 rounded-md border border-dashed px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{t('businesses.scope.pick')}</span>
        <span className="text-muted-foreground">
          {t('businesses.scope.readyCount', { count: picked.size })}
        </span>
      </div>
      {ready.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {ready.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={picked.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className="min-w-0 flex-1 truncate" title={r.url || r.title}>
                  {r.title || r.url || t('businesses.references.pastedText')}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {t(`enums.referenceKind.${r.kind}`)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        needsReference && (
          <p className="text-xs text-destructive">{t('businesses.scope.noReferences')}</p>
        )
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="ltr"
            className="h-8 ps-8 text-xs"
            placeholder={t('businesses.scope.quickLink')}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && /^https?:\/\//i.test(link.trim())) addLink();
            }}
          />
        </div>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t('businesses.references.add')}
          disabled={!/^https?:\/\//i.test(link.trim())}
          isLoading={add.isPending}
          onClick={addLink}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/** Whether the chosen scope has something to read (mirrors the server check). */
export function scopeIsUsable(
  value: ScopeValue,
  refs: BusinessReference[] | undefined,
  hasWebsite: boolean,
): boolean {
  if (value.scope === 'NONE' || value.scope === 'WEB') return true;
  const ready = usableReferences(refs);
  const count = value.referenceIds
    ? value.referenceIds.filter((id) => ready.some((r) => r.id === id)).length
    : ready.length;
  return count > 0 || (value.scope === 'REFERENCE_SITES' && hasWebsite);
}
