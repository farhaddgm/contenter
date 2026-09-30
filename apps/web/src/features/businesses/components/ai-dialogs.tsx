import { useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { BuildScope, BusinessSectionKey, ResearchScope } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { useBuildBusiness, useReferences, useSuggest } from '../api/businesses';
import { ScopePicker, scopeIsUsable, usableReferences, type ScopeValue } from './scope-picker';

/** Starts on the admin's references when there are any; otherwise on `fallback`. */
function useScope(businessId: string, fallback: ResearchScope, hasWebsite: boolean) {
  const refs = useReferences(businessId);
  const [chosen, setChosen] = useState<ScopeValue | null>(null);
  const value: ScopeValue = chosen ?? {
    scope: usableReferences(refs.data).length ? 'REFERENCES' : fallback,
    referenceIds: null,
  };
  return {
    value,
    setValue: setChosen,
    usable: scopeIsUsable(value, refs.data, hasWebsite),
    payload: { scope: value.scope, referenceIds: value.referenceIds ?? undefined },
  };
}

/**
 * Asks AI to propose the selected sections (BUSINESS_SUGGEST). Mounted only while open;
 * `onQueued` receives the job so the page can track it.
 */
export function SuggestDialog({
  businessId,
  hasWebsite,
  initialKeys,
  emptyKeys,
  onQueued,
  onOpenChange,
}: {
  businessId: string;
  hasWebsite: boolean;
  initialKeys: BusinessSectionKey[];
  emptyKeys: BusinessSectionKey[];
  onQueued: (jobId: string, keys: BusinessSectionKey[]) => void;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const suggest = useSuggest(businessId);
  const [keys, setKeys] = useState<Set<BusinessSectionKey>>(new Set(initialKeys));
  const [instruction, setInstruction] = useState('');
  const scope = useScope(businessId, 'NONE', hasWebsite);

  const toggle = (k: BusinessSectionKey) =>
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const submit = () =>
    suggest.mutate(
      {
        keys: BusinessSectionKey.filter((k) => keys.has(k)),
        instruction: instruction.trim(),
        ...scope.payload,
      },
      {
        onSuccess: (r) => {
          notify.info(t('businesses.suggest.queued'));
          onQueued(r.jobId, r.keys);
          onOpenChange(false);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.suggest.title')}
      description={t('businesses.suggest.subtitle')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Sparkles />}
            onClick={submit}
            isLoading={suggest.isPending}
            disabled={!keys.size || !scope.usable}
          >
            {t('businesses.suggest.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{t('businesses.suggest.sections')}</span>
            {emptyKeys.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setKeys(new Set(emptyKeys))}>
                {t('businesses.suggest.emptyOnly')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {BusinessSectionKey.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={keys.has(k)}
                onClick={() => toggle(k)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  keys.has(k)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`enums.businessSection.${k}`)}
                {emptyKeys.includes(k) && ' •'}
              </button>
            ))}
          </div>
          {!keys.size && (
            <p className="text-xs text-destructive">{t('businesses.suggest.noneSelected')}</p>
          )}
        </div>
        <Field
          label={t('businesses.instruction')}
          hint={t('businesses.instructionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={instruction}
              maxLength={2000}
              onChange={(e) => setInstruction(e.target.value)}
            />
          )}
        </Field>
        <ScopePicker
          businessId={businessId}
          scopes={ResearchScope}
          value={scope.value}
          onChange={scope.setValue}
          hasWebsite={hasWebsite}
        />
      </div>
    </Dialog>
  );
}

/**
 * Confirms a web-research build of the whole profile (BUSINESS_BUILD). Mounted only while open.
 * The business refetches as BUILDING with `lastJobId`, which the page tracks.
 */
export function BuildDialog({
  businessId,
  hasWebsite,
  onOpenChange,
}: {
  businessId: string;
  hasWebsite: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const build = useBuildBusiness(businessId);
  const [instruction, setInstruction] = useState('');
  const scope = useScope(businessId, 'WEB', hasWebsite);
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.buildTitle')}
      description={t('businesses.buildBody')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Globe />}
            isLoading={build.isPending}
            disabled={!scope.usable}
            onClick={() =>
              build.mutate(
                {
                  instruction: instruction.trim(),
                  scope: scope.payload.scope as BuildScope,
                  referenceIds: scope.payload.referenceIds,
                },
                {
                  onSuccess: () => {
                    notify.info(t('businesses.buildQueued'));
                    onOpenChange(false);
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('businesses.researchBuild')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ScopePicker
          businessId={businessId}
          scopes={BuildScope}
          value={scope.value}
          onChange={scope.setValue}
          hasWebsite={hasWebsite}
        />
        <Field
          label={t('businesses.instruction')}
          hint={t('businesses.instructionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={instruction}
              maxLength={2000}
              onChange={(e) => setInstruction(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
