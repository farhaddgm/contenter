import { useState } from 'react';
import { Link } from 'react-router';
import { CornerUpLeft, Layers, Loader2, Sparkles } from 'lucide-react';
import {
  ContentFormat,
  defaultFormatFor,
  effectivePlatform,
  MAX_REPURPOSE_TARGETS,
  Platform,
  type Content,
} from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form-controls';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { useRepurpose } from '../api/contents';

type Picked = Partial<Record<Platform, ContentFormat>>;

/** Mounted only while open, so the choices start empty without a reset effect. */
export function RepurposeDialog({ content, onClose }: { content: Content; onClose: () => void }) {
  const t = useT();
  const repurpose = useRepurpose(content.id);
  const [picked, setPicked] = useState<Picked>({});
  const [notes, setNotes] = useState('');
  const own = content.topic ? effectivePlatform(content, content.topic) : null;
  const platforms = Object.keys(picked) as Platform[];

  const toggle = (p: Platform) =>
    setPicked((cur) => {
      const next = { ...cur };
      if (p in next) delete next[p];
      else if (Object.keys(next).length < MAX_REPURPOSE_TARGETS) next[p] = defaultFormatFor(p);
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('repurpose.title')}
      description={t('repurpose.subtitle')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Sparkles />}
            disabled={!platforms.length}
            isLoading={repurpose.isPending}
            onClick={() =>
              repurpose.mutate(
                {
                  targets: platforms.map((platform) => ({ platform, format: picked[platform] })),
                  notes,
                },
                {
                  onSuccess: (r) => {
                    notify.info(t('repurpose.queued', { count: r.items.length }));
                    onClose();
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('repurpose.submit', { count: platforms.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('repurpose.platforms')}</p>
          <ul className="space-y-1.5">
            {Platform.map((p) => {
              const on = p in picked;
              return (
                <li
                  key={p}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
                    on && 'border-primary/50 bg-primary/5',
                  )}
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={on}
                      onChange={() => toggle(p)}
                    />
                    {t(`enums.platform.${p}`)}
                    {p === own && <Badge tone="neutral">{t('repurpose.current')}</Badge>}
                  </label>
                  {on && (
                    <Select
                      className="h-8 w-52 text-xs"
                      aria-label={`${t('contents.format')} — ${t(`enums.platform.${p}`)}`}
                      value={picked[p]}
                      onChange={(e) =>
                        setPicked((cur) => ({ ...cur, [p]: e.target.value as ContentFormat }))
                      }
                      options={ContentFormat.map((f) => ({
                        value: f,
                        label: t(`enums.contentFormat.${f}`),
                      }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <Field
          label={t('repurpose.direction')}
          hint={t('repurpose.directionHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              dir="auto"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Where this content came from and what was made from it for other platforms. */
export function RepurposedCard({ content }: { content: Content }) {
  const t = useT();
  const { source, repurposed = [] } = content;
  if (!source && !repurposed.length) return null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Layers className="size-4" />
            {t('repurpose.versions')}
          </span>
        }
      />
      <div className="space-y-3 p-4 text-sm">
        {source && (
          <Link
            to={paths.app.content.getHref(source.id)}
            className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 hover:bg-accent"
          >
            <CornerUpLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">{t('repurpose.madeFrom')}</span>
              <span className="block truncate font-medium" dir="auto">
                {source.title}
              </span>
            </span>
          </Link>
        )}
        {!!repurposed.length && (
          <ul className="space-y-1.5">
            {repurposed.map((r) => (
              <li key={r.id}>
                <Link
                  to={paths.app.content.getHref(r.id)}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted"
                >
                  {r.platform && <Badge tone="primary">{t(`enums.platform.${r.platform}`)}</Badge>}
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {t(`enums.contentFormat.${r.format}`)}
                  </span>
                  <Badge tone={statusTone[r.status]}>
                    {r.status === 'GENERATING' && <Loader2 className="animate-spin" />}
                    {t(`enums.contentStatus.${r.status}`)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
