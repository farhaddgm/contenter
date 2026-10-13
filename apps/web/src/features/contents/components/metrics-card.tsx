import { useState } from 'react';
import { ClipboardPaste, LineChart, Plus, Trash2 } from 'lucide-react';
import {
  METRIC_FIELDS,
  parseMetricsTable,
  type Content,
  type ContentMetric,
  type MetricField,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { PageSpinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber, formatPercent } from '@/utils/format';
import { useAddMetric, useBulkMetrics, useDeleteMetric, useMetrics } from '../api/contents';

const today = () => new Date().toISOString().slice(0, 10);

const cell = (n: number | null, fraction = 0) => (n === null ? '—' : formatNumber(n, fraction));

/** Mounted only while open, so the inputs start empty without a reset effect. */
function AddMetricDialog({ contentId, onClose }: { contentId: string; onClose: () => void }) {
  const t = useT();
  const add = useAddMetric(contentId);
  const [day, setDay] = useState(today());
  const [values, setValues] = useState<Partial<Record<MetricField, string>>>({});
  const [note, setNote] = useState('');

  const numbers = Object.fromEntries(
    METRIC_FIELDS.flatMap((f) => {
      const raw = values[f]?.trim();
      if (!raw) return [];
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? [[f, f === 'revenue' ? n : Math.round(n)]] : [];
    }),
  ) as Partial<Record<MetricField, number>>;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('contents.metrics.addTitle')}
      description={t('contents.metrics.addHint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!Object.keys(numbers).length || !day}
            isLoading={add.isPending}
            onClick={() =>
              add.mutate(
                { measuredAt: day, ...numbers, note },
                {
                  onSuccess: () => {
                    notify.success(t('contents.metrics.saved'));
                    onClose();
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('contents.metrics.date')}>
          {(id) => (
            <Input id={id} type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {METRIC_FIELDS.map((f) => (
            <Field key={f} label={t(`contents.metrics.fields.${f}`)}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={values[f] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
        <Field label={t('contents.metrics.note')} optional={t('common.optional')}>
          {(id) => (
            <Input id={id} dir="auto" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Paste a table from a spreadsheet or a platform export; checked in the browser before sending. */
function PasteMetricsDialog({ contentId, onClose }: { contentId: string; onClose: () => void }) {
  const t = useT();
  const bulk = useBulkMetrics(contentId);
  const [text, setText] = useState('');
  const [defaultDay, setDefaultDay] = useState('');
  const parsed = text.trim() ? parseMetricsTable(text, defaultDay || undefined) : null;
  const errorText = (m: string) => {
    const [code, arg] = m.split(':');
    return t(`contents.metrics.parse.${code as 'EMPTY'}`, { arg: arg ?? '' });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('contents.metrics.pasteTitle')}
      description={t('contents.metrics.pasteHint')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!parsed?.rows.length}
            isLoading={bulk.isPending}
            onClick={() =>
              bulk.mutate(
                { rows: parsed!.rows },
                {
                  onSuccess: () => {
                    notify.success(t('contents.metrics.saved'));
                    onClose();
                  },
                  onError: (e) => notify.error(t('common.error'), e.message),
                },
              )
            }
          >
            {t('contents.metrics.importRows', { count: formatNumber(parsed?.rows.length ?? 0) })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('contents.metrics.table')}>
          {(id) => (
            <Textarea
              id={id}
              rows={8}
              dir="ltr"
              className="font-mono text-xs"
              placeholder={'date\tviews\tlikes\tsaves\n2026-10-01\t1200\t80\t12'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('contents.metrics.defaultDay')}
          hint={t('contents.metrics.defaultDayHint')}
          optional={t('common.optional')}
        >
          {(id) => (
            <Input
              id={id}
              type="date"
              max={today()}
              value={defaultDay}
              onChange={(e) => setDefaultDay(e.target.value)}
            />
          )}
        </Field>
        {parsed && (
          <div className="space-y-1 text-sm">
            <p className={parsed.rows.length ? 'text-success' : 'text-muted-foreground'}>
              {t('contents.metrics.readable', { count: formatNumber(parsed.rows.length) })}
            </p>
            {parsed.errors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-destructive">
                {parsed.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>
                    {e.line ? t('contents.metrics.line', { line: formatNumber(e.line) }) : ''}
                    {errorText(e.message)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Readings({ contentId, items }: { contentId: string; items: ContentMetric[] }) {
  const t = useT();
  const remove = useDeleteMetric(contentId);
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-3 py-2 text-start font-medium">{t('contents.metrics.date')}</th>
            {METRIC_FIELDS.map((f) => (
              <th key={f} className="px-2 py-2 text-end font-medium">
                {t(`contents.metrics.fields.${f}`)}
              </th>
            ))}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(m.measuredAt, false)}</td>
              {METRIC_FIELDS.map((f) => (
                <td key={f} className="px-2 py-2 text-end tabular-nums">
                  {cell(m[f], f === 'revenue' ? 2 : 0)}
                </td>
              ))}
              <td className="px-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('common.delete')}
                  isLoading={remove.isPending && removing === m.id}
                  onClick={() => {
                    setRemoving(m.id);
                    remove.mutate(m.id, {
                      onError: (e) => notify.error(t('common.error'), e.message),
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Performance numbers typed or pasted by hand for a published content (docs/42). The server
 * only accepts readings for published content, so the card explains how to unlock it otherwise.
 */
export function MetricsCard({ content, canEdit }: { content: Content; canEdit: boolean }) {
  const t = useT();
  const published = Boolean(content.publishedAt);
  const query = useMetrics(content.id, published);
  const [dialog, setDialog] = useState<'add' | 'paste' | null>(null);
  const summary = query.data?.summary;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <LineChart className="size-4" />
            {t('contents.metrics.title')}
          </span>
        }
        description={t('contents.metrics.subtitle')}
        actions={
          published &&
          canEdit && (
            <>
              <Button
                size="sm"
                variant="outline"
                icon={<ClipboardPaste />}
                onClick={() => setDialog('paste')}
              >
                {t('contents.metrics.paste')}
              </Button>
              <Button size="sm" icon={<Plus />} onClick={() => setDialog('add')}>
                {t('contents.metrics.add')}
              </Button>
            </>
          )
        }
      />
      <CardBody className="space-y-3">
        {!published && (
          <p className="text-sm text-muted-foreground">{t('contents.metrics.notPublished')}</p>
        )}
        {published && query.isLoading && <PageSpinner />}
        {published && query.data && !query.data.items.length && (
          <p className="text-sm text-muted-foreground">{t('contents.metrics.empty')}</p>
        )}
        {summary?.latest && (
          <p className="text-sm text-muted-foreground">
            {t('contents.metrics.summary', {
              date: formatDate(summary.latest.measuredAt, false),
              rate: summary.engagementRate === null ? '—' : formatPercent(summary.engagementRate),
            })}
          </p>
        )}
        {query.data && query.data.items.length > 0 && (
          <Readings contentId={content.id} items={query.data.items} />
        )}
      </CardBody>
      {dialog === 'add' && <AddMetricDialog contentId={content.id} onClose={() => setDialog(null)} />}
      {dialog === 'paste' && (
        <PasteMetricsDialog contentId={content.id} onClose={() => setDialog(null)} />
      )}
    </Card>
  );
}
