import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useDiscover } from '../api/businesses';
import { CONTENT_LANGS } from './business-form';

/** Keyword → BUSINESS_DISCOVER job; opens the discovery page. Mounted only while open. */
export function DiscoverDialog({ onOpenChange }: { onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const discover = useDiscover();
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [count, setCount] = useState('5');
  const [language, setLanguage] = useState('fa');
  const [notes, setNotes] = useState('');

  const submit = () =>
    discover.mutate(
      {
        keyword: keyword.trim(),
        location: location.trim(),
        count: Number(count),
        language,
        notes: notes.trim(),
      },
      {
        onSuccess: (r) => {
          notify.info(t('businesses.discover.queued'));
          onOpenChange(false);
          navigate(paths.app.discovery.getHref(r.id));
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.discover.title')}
      description={t('businesses.discover.subtitle')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Search />}
            onClick={submit}
            isLoading={discover.isPending}
            disabled={keyword.trim().length < 2}
          >
            {t('businesses.discover.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('businesses.discover.keyword')} hint={t('businesses.discover.keywordHint')}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={keyword}
              maxLength={200}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && keyword.trim().length >= 2) submit();
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('businesses.discover.location')} optional={t('common.optional')}>
            {(id) => (
              <Input
                id={id}
                value={location}
                maxLength={200}
                onChange={(e) => setLocation(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('businesses.discover.count')}>
            {(id) => (
              <Select
                id={id}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                options={[3, 5, 7, 10].map((n) => ({ value: String(n), label: String(n) }))}
              />
            )}
          </Field>
        </div>
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
        <Field label={t('businesses.discover.notes')} optional={t('common.optional')}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
