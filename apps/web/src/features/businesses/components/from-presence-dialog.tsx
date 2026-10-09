import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AtSign, Wand2 } from 'lucide-react';
import { BuildScope, parseInstagramHandle } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useCreateFromPresence, useInstagramStatus } from '../api/businesses';
import { CONTENT_LANGS } from './business-form';
import {
  EMPTY_MANUAL,
  InstagramManualFields,
  toManualInput,
  type ManualInstagramState,
} from './presence-parts';
import { ScopePicker, type ScopeValue } from './scope-picker';

const isHttpUrl = (v: string) => {
  try {
    return /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * "Build from Instagram and website": an account and/or a site → the server reads and analyzes
 * them by code, creates the business and queues BUSINESS_BUILD limited to them (docs/28).
 * Mounted only while open.
 */
export function FromPresenceDialog({ onOpenChange }: { onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateFromPresence();
  const { data: status } = useInstagramStatus();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('fa');
  const [instagram, setInstagram] = useState('');
  const [website, setWebsite] = useState('');
  const [byHand, setByHand] = useState(false);
  const [manual, setManual] = useState<ManualInstagramState>(EMPTY_MANUAL);
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<ScopeValue>({ scope: 'REFERENCES', referenceIds: null });

  const graph = status?.graphConfigured ?? false;
  const handle = instagram.trim() ? parseInstagramHandle(instagram) : null;
  const instagramInvalid = instagram.trim().length > 0 && !handle;
  const websiteInvalid = website.trim().length > 0 && !isHttpUrl(website.trim());
  // Typed data is used when the API cannot read accounts, or when the admin chooses so.
  const showManual = !graph || byHand;
  const manualInput = showManual ? toManualInput(handle ?? '', manual) : undefined;
  const hasInstagram = manualInput ? true : !!handle && graph;
  const valid =
    !instagramInvalid &&
    !websiteInvalid &&
    (hasInstagram || website.trim().length > 0) &&
    // an account that cannot be read needs the data typed in
    !(handle && !graph && !manualInput);

  const submit = () =>
    create.mutate(
      {
        name: name.trim(),
        language,
        instagram: manualInput ? '' : (handle ?? ''),
        instagramManual: manualInput,
        website: website.trim(),
        scope: scope.scope as BuildScope,
        instruction: instruction.trim(),
      },
      {
        onSuccess: (r) => {
          if (r.failed) notify.warning(t('businesses.presence.needsFix', { failed: r.failed }));
          else notify.info(t('businesses.presence.started'));
          onOpenChange(false);
          navigate(paths.app.business.getHref(r.businessId));
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.presence.title')}
      description={t('businesses.presence.subtitle')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button icon={<Wand2 />} onClick={submit} isLoading={create.isPending} disabled={!valid}>
            {t('businesses.presence.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field
            label={t('businesses.presence.name')}
            hint={t('businesses.presence.nameHint')}
            optional={t('common.optional')}
          >
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('businesses.fields.language')}>
            {(id) => (
              <Select
                id={id}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                options={CONTENT_LANGS}
              />
            )}
          </Field>
        </div>

        <Field
          label={t('businesses.presence.instagram')}
          hint={t('businesses.presence.instagramHint')}
          error={instagramInvalid ? t('businesses.presence.invalidInstagram') : undefined}
          optional={t('common.optional')}
        >
          {(id) => (
            <div className="relative">
              <AtSign className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={id}
                dir="ltr"
                className="ps-9"
                placeholder="@brand"
                value={instagram}
                maxLength={300}
                onChange={(e) => setInstagram(e.target.value)}
              />
            </div>
          )}
        </Field>
        <p className="text-xs leading-6 text-muted-foreground">
          {graph ? t('businesses.presence.graphOn') : t('businesses.presence.graphOff')}
        </p>
        {graph && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={byHand} onCheckedChange={setByHand} />
            {t('businesses.presence.manual')}
          </label>
        )}
        {showManual && <InstagramManualFields value={manual} onChange={setManual} />}

        <Field
          label={t('businesses.presence.website')}
          hint={t('businesses.presence.websiteHint')}
          error={websiteInvalid ? t('businesses.presence.invalidWebsite') : undefined}
          optional={t('common.optional')}
        >
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              placeholder="https://brand.ir"
              value={website}
              maxLength={500}
              onChange={(e) => setWebsite(e.target.value)}
            />
          )}
        </Field>
        {!valid && !instagramInvalid && !websiteInvalid && (
          <p className="text-xs text-muted-foreground">{t('businesses.presence.needSource')}</p>
        )}

        <ScopePicker scopes={BuildScope} value={scope} onChange={setScope} />
        <Field
          label={t('businesses.instruction')}
          hint={t('businesses.instructionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={instruction}
              maxLength={2000}
              onChange={(e) => setInstruction(e.target.value)}
            />
          )}
        </Field>
        <p className="text-xs leading-6 text-muted-foreground">{t('businesses.presence.privacy')}</p>
      </div>
    </Dialog>
  );
}
