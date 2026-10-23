import { useState } from 'react';
import { AtSign, ChevronDown, Eye, FileText, Globe, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { COMPETITOR_SOURCE_LIMIT, type CompetitorSourceSummary } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';
import {
  useAddCompetitorSource,
  useCompetitorSources,
  useCompetitorSourceText,
  useDeleteCompetitorSource,
  useRefreshCompetitorSource,
} from '../api/competitors';
import { AddSourceDialog } from './styles-panel';

const KIND_ICON = { INSTAGRAM: AtSign, WEBSITE: Globe, URL: Link2, TEXT: FileText } as const;

/**
 * The sources of one competitor card (docs/70 phase 2): a page, a site, an Instagram account (Graph
 * API or typed by hand) or pasted text, read by code. They are loaded only once the section is open.
 */
export function CompetitorSources({
  businessId,
  competitorId,
  canEdit,
}: {
  businessId: string;
  competitorId: string;
  canEdit: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<CompetitorSourceSummary | null>(null);
  const { data: sources, isLoading } = useCompetitorSources(competitorId, open);
  const full = (sources?.length ?? 0) >= COMPETITOR_SOURCE_LIMIT;

  return (
    <div className="mt-3 border-t pt-2">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        icon={<ChevronDown className={open ? 'rotate-180' : ''} />}
        onClick={() => setOpen((v) => !v)}
      >
        {t('businesses.competitors.sources.title')}
      </Button>
      {open && (
        <div className="space-y-2 pt-2">
          {isLoading ? (
            <Spinner />
          ) : !sources?.length ? (
            <p className="text-xs text-muted-foreground">{t('businesses.competitors.sources.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <SourceItem
                  key={s.id}
                  businessId={businessId}
                  competitorId={competitorId}
                  source={s}
                  canEdit={canEdit}
                  onView={() => setViewing(s)}
                />
              ))}
            </ul>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" icon={<Plus />} disabled={full} onClick={() => setAdding(true)}>
              {t('businesses.competitors.sources.add')}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {t('businesses.competitors.sources.limit', { count: formatNumber(COMPETITOR_SOURCE_LIMIT) })}
          </p>
        </div>
      )}
      {adding && (
        <AddCompetitorSourceDialog
          businessId={businessId}
          competitorId={competitorId}
          onOpenChange={setAdding}
        />
      )}
      {viewing && <SourceTextDialog source={viewing} onOpenChange={() => setViewing(null)} />}
    </div>
  );
}

function AddCompetitorSourceDialog({
  businessId,
  competitorId,
  onOpenChange,
}: {
  businessId: string;
  competitorId: string;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const add = useAddCompetitorSource(businessId, competitorId);
  return (
    <AddSourceDialog
      add={add}
      onOpenChange={onOpenChange}
      title={t('businesses.competitors.sources.addTitle')}
      description={t('businesses.competitors.sources.addSubtitle')}
    />
  );
}

function SourceItem({
  businessId,
  competitorId,
  source,
  canEdit,
  onView,
}: {
  businessId: string;
  competitorId: string;
  source: CompetitorSourceSummary;
  canEdit: boolean;
  onView: () => void;
}) {
  const t = useT();
  const refresh = useRefreshCompetitorSource(businessId, competitorId);
  const remove = useDeleteCompetitorSource(businessId, competitorId);
  const Icon = KIND_ICON[source.kind];
  // pasted text and hand-typed Instagram data have nothing to read again
  const manual = (source.analysis as { provider?: string } | null | undefined)?.provider === 'MANUAL';
  const canRefresh = canEdit && source.kind !== 'TEXT' && !manual;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" data-bidi="">
            {source.title || source.url || t(`enums.styleSourceKind.${source.kind}`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`enums.styleSourceKind.${source.kind}`)}
            {source.status === 'READY' && ` · ${formatNumber(source.chars)}`}
            {source.fetchedAt && ` · ${formatDate(source.fetchedAt)}`}
          </p>
          {source.status === 'FAILED' && source.error && (
            <p className="text-xs text-destructive" data-bidi="">
              {source.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('businesses.styles.viewText')}
          disabled={source.status !== 'READY'}
          onClick={onView}
        >
          <Eye />
        </Button>
        {canRefresh && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('common.refresh')}
            isLoading={refresh.isPending}
            onClick={() =>
              refresh.mutate(source.id, {
                onSuccess: () => notify.success(t('businesses.styles.refreshed')),
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            <RefreshCw />
          </Button>
        )}
        {canEdit && (
          <ConfirmationDialog
            trigger={
              <Button size="icon" variant="ghost" aria-label={t('common.delete')}>
                <Trash2 />
              </Button>
            }
            body={t('businesses.competitors.sources.removeBody')}
            isLoading={remove.isPending}
            onConfirm={() =>
              remove
                .mutateAsync(source.id)
                .then(() => notify.success(t('businesses.styles.sourceRemoved')))
            }
          />
        )}
      </div>
    </li>
  );
}

/** The stored snapshot of a source, exactly what was read. Mounted only while open. */
function SourceTextDialog({
  source,
  onOpenChange,
}: {
  source: CompetitorSourceSummary;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const { data, isLoading } = useCompetitorSourceText(source.id);
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('businesses.styles.viewText')}
      description={source.title || source.url}
      className="max-w-3xl"
    >
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <pre
          data-bidi=""
          className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs leading-6"
        >
          {data.content}
        </pre>
      )}
    </Dialog>
  );
}
