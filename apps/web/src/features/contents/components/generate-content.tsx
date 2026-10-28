import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ContentFormat, type Idea } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatNumber } from '@/utils/format';
import { useIdeas } from '@/features/ideas/api/ideas';
import { FocusNote } from '@/features/topics/components/focus-note';
import { useGenerateContent } from '../api/contents';
import { useVariantLimit } from '../api/variants';
import { EconomyToggle } from './economy-toggle';

/** Starts a GENERATE_CONTENT job from an idea or a free brief, then opens the content page. */
export function GenerateContentDialog({
  topicId,
  open,
  onOpenChange,
  idea,
}: {
  topicId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  idea?: Idea | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const generate = useGenerateContent(topicId);
  // Mounted only while open (see call sites), so initial state comes straight from props.
  const [mode, setMode] = useState<'idea' | 'brief'>(idea ? 'idea' : 'brief');
  const [ideaId, setIdeaId] = useState(idea?.id ?? '');
  const [brief, setBrief] = useState('');
  const [format, setFormat] = useState<string>(idea?.format ?? '');
  const [variants, setVariants] = useState(1);
  const limit = useVariantLimit(topicId);
  const maxVariants = limit.data?.maxVariants ?? 1;
  const [economy, setEconomy] = useState(false);
  const ideas = useIdeas(topicId, { page: 1, pageSize: 100 });

  const usable = ideas.data?.items.filter((i) => i.status !== 'REJECTED') ?? [];
  const canSubmit = mode === 'idea' ? !!ideaId : brief.trim().length >= 10;

  const submit = () =>
    generate.mutate(
      {
        ideaId: mode === 'idea' ? ideaId : undefined,
        brief: mode === 'brief' ? brief.trim() : '',
        format: (format || undefined) as (typeof ContentFormat)[number] | undefined,
        variants: Math.min(variants, maxVariants),
        economy: economy || undefined,
      },
      {
        onSuccess: (r) => {
          notify.info(t('contents.queued'));
          onOpenChange(false);
          // drafts written side by side are compared on their own page
          navigate(
            r.variants.length > 1
              ? paths.app.contentCompare.getHref(r.contentId)
              : paths.app.content.getHref(r.contentId),
          );
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('contents.generate')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} isLoading={generate.isPending} disabled={!canSubmit}>
            {t('contents.generate')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FocusNote topicId={topicId} />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'idea', label: t('contents.fromIdea') },
            { value: 'brief', label: t('contents.fromBrief') },
          ]}
        />
        {mode === 'idea' ? (
          <Field label={t('contents.idea')}>
            {(id) => (
              <Select
                id={id}
                value={ideaId}
                onChange={(e) => {
                  setIdeaId(e.target.value);
                  const picked = usable.find((i) => i.id === e.target.value);
                  if (picked) setFormat(picked.format);
                }}
                placeholder={t('contents.selectIdea')}
                options={usable.map((i) => ({ value: i.id, label: i.title }))}
              />
            )}
          </Field>
        ) : (
          <Field label={t('contents.brief')} hint={t('contents.briefHint')}>
            {(id) => (
              <Textarea id={id} rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} />
            )}
          </Field>
        )}
        <Field label={t('contents.format')}>
          {(id) => (
            <Select
              id={id}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder={t('ideas.anyFormat')}
              options={ContentFormat.map((f) => ({
                value: f,
                label: t(`enums.contentFormat.${f}`),
              }))}
            />
          )}
        </Field>
        {maxVariants > 1 && (
          <Field label={t('variants.count')} hint={t('variants.costHint')}>
            {(id) => (
              <Select
                id={id}
                value={String(Math.min(variants, maxVariants))}
                onChange={(e) => setVariants(Number(e.target.value))}
                options={Array.from({ length: maxVariants }, (_, i) => ({
                  value: String(i + 1),
                  label:
                    i === 0 ? t('variants.one') : t('variants.many', { n: formatNumber(i + 1) }),
                }))}
              />
            )}
          </Field>
        )}
        <EconomyToggle checked={economy} onChange={setEconomy} />
      </div>
    </Dialog>
  );
}
