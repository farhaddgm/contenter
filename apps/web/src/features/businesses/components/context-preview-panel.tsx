import { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import {
  ContextTarget,
  type BusinessSectionKey,
  type ContextBlock,
  type ContextBlockId,
  type ContextReport,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { CopyButton, Segmented } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { useT, type TFn } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber, formatPercent, formatUsd } from '@/utils/format';
import { useContextPreview } from '../api/context-preview';

/** Colour of a block in the bar: profile text, rules and facts, past material, documents. */
function toneOf(id: ContextBlockId): string {
  if (id === 'HEAD' || id.startsWith('SECTION:')) return 'bg-primary';
  if (id === 'FACTS' || id === 'TERMS') return 'bg-success';
  if (id === 'DOCUMENTS') return 'bg-muted-foreground/60';
  return 'bg-warning';
}

export function blockLabel(t: TFn, id: ContextBlockId): string {
  return id.startsWith('SECTION:')
    ? t(`enums.businessSection.${id.slice('SECTION:'.length) as BusinessSectionKey}`)
    : t(`businesses.context.blocks.${id as Exclude<ContextBlockId, `SECTION:${string}`>}`);
}

function BlockRow({
  block,
  total,
  open,
  onToggle,
}: {
  block: ContextBlock;
  total: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <>
      <tr className="border-t">
        <td className="py-2 pe-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex items-center gap-2 text-start font-medium hover:text-primary"
          >
            <span className={cn('size-2.5 shrink-0 rounded-sm', toneOf(block.id))} aria-hidden />
            {blockLabel(t, block.id)}
            <ChevronDown className={cn('size-3.5 shrink-0 transition', open && 'rotate-180')} />
            <span className="sr-only">
              {open ? t('businesses.context.hide') : t('businesses.context.show')}
            </span>
          </button>
          <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
            {block.cut && (
              <Badge tone="warning">
                {block.omitted > 0
                  ? t('businesses.context.omitted', { count: formatNumber(block.omitted) })
                  : t('businesses.context.cut')}
              </Badge>
            )}
            {block.unreviewed && <Badge tone="warning">{t('businesses.context.unreviewed')}</Badge>}
          </div>
        </td>
        <td className="px-2 py-2 text-end tabular-nums">{formatNumber(block.chars)}</td>
        <td className="px-2 py-2 text-end tabular-nums">{formatNumber(block.estTokens)}</td>
        <td className="ps-2 py-2 text-end tabular-nums text-muted-foreground">
          {formatPercent(total > 0 ? block.chars / total : 0, 0)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="pb-3">
            <pre
              data-bidi=""
              className="max-h-80 overflow-auto whitespace-pre-wrap rounded-control bg-muted p-3 text-start text-xs leading-6"
            >
              {block.text}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function Report({ report }: { report: ContextReport }) {
  const t = useT();
  const [open, setOpen] = useState<ReadonlySet<ContextBlockId>>(new Set());
  const toggle = (id: ContextBlockId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const fullText = report.blocks.map((b) => b.text).join('\n\n');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-semibold tabular-nums">
          {t('businesses.context.total', {
            chars: formatNumber(report.totalChars),
            tokens: formatNumber(report.estTokens),
          })}
        </p>
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
          title={t('businesses.context.barHint')}
        >
          {report.blocks.map((b) => (
            <span
              key={b.id}
              className={cn('h-full border-e border-card last:border-e-0', toneOf(b.id))}
              style={{ width: `${(b.chars / Math.max(1, report.totalChars)) * 100}%` }}
            />
          ))}
        </div>
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {report.estCostUsd !== null && (
            <li>{t('businesses.context.cost', { cost: formatUsd(report.estCostUsd) })}</li>
          )}
          {report.model && <li data-bidi="">{t('businesses.context.model', { model: report.model })}</li>}
          <li>
            {t(`businesses.context.ratio.${report.ratio.source}`, {
              value: formatNumber(report.ratio.charsPerToken, 2),
              samples: formatNumber(report.ratio.samples),
            })}
          </li>
        </ul>
      </div>

      {report.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {report.warnings.map((w) => (
            <li
              key={w.code}
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-6"
            >
              <AlertTriangle className="mt-1 size-3.5 shrink-0 text-warning" />
              {t(`businesses.context.warnings.${w.code}`, { count: formatNumber(w.count) })}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="pb-2 pe-3 text-start font-semibold">
                {t('businesses.context.table.block')}
              </th>
              <th scope="col" className="px-2 pb-2 text-end font-semibold">
                {t('businesses.context.table.chars')}
              </th>
              <th scope="col" className="px-2 pb-2 text-end font-semibold">
                {t('businesses.context.table.tokens')}
              </th>
              <th scope="col" className="ps-2 pb-2 text-end font-semibold">
                {t('businesses.context.table.share')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.blocks.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                total={report.totalChars}
                open={open.has(b.id)}
                onToggle={() => toggle(b.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <CopyButton text={fullText} label={t('businesses.context.copyAll')} />
    </div>
  );
}

/** "What the model sees": the blocks of the `business` prompt variable with their size (docs/66). */
export function ContextPreviewPanel({
  businessId,
  topics,
}: {
  businessId: string;
  topics: { id: string; title: string }[];
}) {
  const t = useT();
  const [target, setTarget] = useState<ContextTarget>('DRAFT');
  const [topicId, setTopicId] = useState('');
  const usesTopic = target !== 'PROFILE';
  const preview = useContextPreview(businessId, target, usesTopic ? topicId : '');

  return (
    <Card>
      <CardHeader
        title={t('businesses.context.title')}
        description={t('businesses.context.hint')}
        descriptionAsTip
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            value={target}
            onChange={setTarget}
            options={ContextTarget.map((value) => ({
              value,
              label: t(`businesses.context.target.${value}`),
            }))}
          />
          {usesTopic && topics.length > 0 && (
            <div className="min-w-48">
              <Select
                aria-label={t('businesses.context.topicLabel')}
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                placeholder={t('businesses.context.topicNone')}
                options={topics.map((x) => ({ value: x.id, label: x.title }))}
              />
            </div>
          )}
        </div>
        {preview.isLoading && <PageSpinner />}
        {preview.data && (
          <>
            {preview.data.needsTopic && (
              <p className="text-xs leading-6 text-muted-foreground">
                {t('businesses.context.needsTopic')}
              </p>
            )}
            {preview.data.topicId && (
              <p className="text-xs leading-6 text-muted-foreground">
                {t('businesses.context.documentsNote')}
              </p>
            )}
            <Report key={`${target}:${preview.data.topicId ?? ''}`} report={preview.data} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
