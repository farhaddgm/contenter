import { useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { BusinessSectionKey } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Switch, Textarea } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { useBuildBusiness, useSuggest } from '../api/businesses';

/**
 * Asks AI to propose the selected sections (BUSINESS_SUGGEST). Mounted only while open;
 * `onQueued` receives the job so the page can track it.
 */
export function SuggestDialog({
  businessId,
  initialKeys,
  emptyKeys,
  onQueued,
  onOpenChange,
}: {
  businessId: string;
  initialKeys: BusinessSectionKey[];
  emptyKeys: BusinessSectionKey[];
  onQueued: (jobId: string, keys: BusinessSectionKey[]) => void;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const suggest = useSuggest(businessId);
  const [keys, setKeys] = useState<Set<BusinessSectionKey>>(new Set(initialKeys));
  const [instruction, setInstruction] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);

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
        useWebSearch,
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
            disabled={!keys.size}
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
        <Switch
          checked={useWebSearch}
          onCheckedChange={setUseWebSearch}
          label={
            <span className="flex items-center gap-1.5">
              <Globe className="size-4 text-muted-foreground" />
              {t('businesses.suggest.webSearch')}
            </span>
          }
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
  onOpenChange,
}: {
  businessId: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const build = useBuildBusiness(businessId);
  const [instruction, setInstruction] = useState('');
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.buildTitle')}
      description={t('businesses.buildBody')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Globe />}
            isLoading={build.isPending}
            onClick={() =>
              build.mutate(
                { instruction: instruction.trim() },
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
    </Dialog>
  );
}
