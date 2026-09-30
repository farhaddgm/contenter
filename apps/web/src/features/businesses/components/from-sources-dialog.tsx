import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Wand2 } from 'lucide-react';
import { BUSINESS_REFERENCE_MAX_CHARS, BuildScope } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useCreateFromReferences } from '../api/businesses';
import { CONTENT_LANGS } from './business-form';
import { GoogleLinkHint, splitLinks, TextFileButton } from './references-card';
import { ScopePicker, type ScopeValue } from './scope-picker';

/**
 * "Build from my sources": name + links / document text → the server creates the business,
 * reads the references and queues BUSINESS_BUILD limited to them. Mounted only while open.
 */
export function FromSourcesDialog({ onOpenChange }: { onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateFromReferences();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('fa');
  const [website, setWebsite] = useState('');
  const [urls, setUrls] = useState('');
  const [text, setText] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<ScopeValue>({ scope: 'REFERENCES', referenceIds: null });
  const { links, invalid } = splitLinks(urls);
  const hasSource = links.length > 0 || text.trim().length > 0;
  const valid = name.trim().length > 0 && hasSource && !invalid.length;

  const submit = () =>
    create.mutate(
      {
        name: name.trim(),
        language,
        website: website.trim(),
        urls: links,
        text: text.trim(),
        textTitle: textTitle.trim(),
        scope: scope.scope as BuildScope,
        instruction: instruction.trim(),
      },
      {
        onSuccess: (r) => {
          if (r.failed) notify.warning(t('businesses.fromSources.needsFix', { failed: r.failed }));
          else notify.info(t('businesses.fromSources.started'));
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
      title={t('businesses.fromSources.title')}
      description={t('businesses.fromSources.subtitle')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button icon={<Wand2 />} onClick={submit} isLoading={create.isPending} disabled={!valid}>
            {t('businesses.fromSources.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label={t('businesses.fields.name')}>
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
          label={t('businesses.fromSources.links')}
          hint={t('businesses.references.urlHint')}
          error={
            invalid.length
              ? t('businesses.fromSources.invalidLinks', { lines: invalid.slice(0, 3).join(' , ') })
              : undefined
          }
        >
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              dir="ltr"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
            />
          )}
        </Field>
        <GoogleLinkHint links={links} />
        <Field
          label={t('businesses.references.text')}
          hint={t('businesses.references.textHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              dir="auto"
              value={text}
              maxLength={BUSINESS_REFERENCE_MAX_CHARS}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <TextFileButton
          onLoad={(content, fileName) => {
            setText(content);
            setTextTitle(fileName);
          }}
        />
        {!hasSource && (
          <p className="text-xs text-muted-foreground">{t('businesses.fromSources.needSource')}</p>
        )}
        <ScopePicker scopes={BuildScope} value={scope} onChange={setScope} />
        {scope.scope !== 'REFERENCES' && (
          <Field label={t('businesses.fields.website')} optional={t('common.optional')}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                value={website}
                maxLength={500}
                onChange={(e) => setWebsite(e.target.value)}
              />
            )}
          </Field>
        )}
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
      </div>
    </Dialog>
  );
}
