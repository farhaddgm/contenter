import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownAZ, ArrowUpAZ, ListFilter, Search, X } from 'lucide-react';
import {
  ContentFormat,
  ContentSort,
  ContentStatus,
  NO_CAMPAIGN,
  Platform,
  ScheduleFilter,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Segmented } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import { useCampaigns } from '@/features/campaigns/api/campaigns';
import { useTags } from '@/features/tags/api/tags';
import { tagSwatchClass } from '@/features/tags/components/tag-chip';
import { activeFilterCount, type ContentFilters } from '../filters';

/** Toggle buttons for a multi-select filter: several chosen values widen the list. */
function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: ReactNode;
  options: { value: T; label: ReactNode; dot?: string }[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])
              }
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {o.dot && <span className={cn('size-2 rounded-full', o.dot)} />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A search box that tells the page what was typed once the typing pauses. */
function SearchInput({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const debounced = useDebounce(text);
  useEffect(() => {
    if (debounced !== initial) onSearch(debounced);
    // only a pause in typing should search, not a new `onSearch` identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className="relative w-full max-w-xs">
      <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="ps-9"
        dir="auto"
        placeholder={t('common.search')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}

const ADVANCED_KEYS = [
  'formats',
  'platforms',
  'tagIds',
  'campaignId',
  'schedule',
  'from',
  'to',
] as const;

/**
 * The filter bar of the content list: search, status shortcuts, sorting, and a panel with the
 * rest (docs/24-search-filters.md). The state lives in the URL; this only renders and reports.
 */
export function ContentFiltersBar({
  filters,
  onChange,
  onReset,
  topicId,
}: {
  filters: ContentFilters;
  /** Changing any filter goes back to the first page. */
  onChange: (patch: Partial<ContentFilters>) => void;
  onReset: () => void;
  /** Tags and campaigns are per topic, so they are offered only inside one. */
  topicId?: string;
}) {
  const t = useT();
  const tags = useTags(topicId);
  const campaigns = useCampaigns(topicId);
  const count = activeFilterCount(filters);
  const hasAdvanced = ADVANCED_KEYS.some((k) => {
    const v = filters[k];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });
  const [open, setOpen] = useState(hasAdvanced);
  // "clear all" must also empty the search box, which keeps its own text
  const [resetRound, setResetRound] = useState(0);
  const set = (patch: Partial<ContentFilters>) => onChange({ ...patch, page: 1 });

  const quickStatus = filters.statuses.length === 1 ? filters.statuses[0]! : '';
  const showOnlyOneStatus = filters.statuses.length <= 1;

  return (
    <div className="border-b">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <SearchInput key={resetRound} initial={filters.q} onSearch={(q) => set({ q })} />
        {showOnlyOneStatus && (
          <Segmented
            value={quickStatus}
            onChange={(v) => set({ statuses: v ? [v] : [] })}
            options={[
              { value: '', label: t('common.all') },
              { value: 'DRAFT', label: t('enums.contentStatus.DRAFT') },
              { value: 'IN_REVIEW', label: t('enums.contentStatus.IN_REVIEW') },
              { value: 'APPROVED', label: t('enums.contentStatus.APPROVED') },
              { value: 'REJECTED', label: t('enums.contentStatus.REJECTED') },
            ]}
          />
        )}
        <Button
          size="sm"
          variant={open ? 'secondary' : 'outline'}
          icon={<ListFilter />}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {t('filters.more')}
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] tabular-nums text-primary-foreground">
              {formatNumber(count)}
            </span>
          )}
        </Button>
        <div className="flex-1" />
        <Select
          className="h-8 w-40 text-xs"
          aria-label={t('filters.sortBy')}
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as ContentFilters['sort'], page: 1 })}
          options={ContentSort.map((s) => ({ value: s, label: t(`filters.sort.${s}`) }))}
        />
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={filters.order === 'asc' ? t('filters.ascending') : t('filters.descending')}
          onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc', page: 1 })}
        >
          {filters.order === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </Button>
        {count > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<X />}
            onClick={() => {
              setResetRound((n) => n + 1);
              onReset();
            }}
          >
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {open && (
        <div className="grid gap-4 border-t bg-muted/20 p-4 md:grid-cols-2">
          <ChipGroup
            label={t('common.status')}
            value={filters.statuses}
            onChange={(statuses) => set({ statuses })}
            options={ContentStatus.filter((s) => s !== 'GENERATING' && s !== 'FAILED').map((s) => ({
              value: s,
              label: t(`enums.contentStatus.${s}`),
            }))}
          />
          <ChipGroup
            label={t('contents.format')}
            value={filters.formats}
            onChange={(formats) => set({ formats })}
            options={ContentFormat.map((f) => ({ value: f, label: t(`enums.contentFormat.${f}`) }))}
          />
          <ChipGroup
            label={t('filters.platform')}
            value={filters.platforms}
            onChange={(platforms) => set({ platforms })}
            options={Platform.map((p) => ({ value: p, label: t(`enums.platform.${p}`) }))}
          />
          {!!tags.data?.length && (
            <ChipGroup
              label={t('tags.title')}
              value={filters.tagIds}
              onChange={(tagIds) => set({ tagIds })}
              options={tags.data.map((tag) => ({
                value: tag.id,
                label: tag.name,
                dot: tagSwatchClass[tag.color],
              }))}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2 md:col-span-2 md:grid-cols-4">
            {topicId && (
              <Field label={t('campaigns.one')}>
                {(id) => (
                  <Select
                    id={id}
                    placeholder={t('campaigns.allCampaigns')}
                    value={filters.campaignId}
                    onChange={(e) => set({ campaignId: e.target.value })}
                    options={[
                      { value: NO_CAMPAIGN, label: t('campaigns.none') },
                      ...(campaigns.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                )}
              </Field>
            )}
            <Field label={t('filters.schedule.label')}>
              {(id) => (
                <Select
                  id={id}
                  placeholder={t('common.all')}
                  value={filters.schedule}
                  onChange={(e) => set({ schedule: e.target.value as ContentFilters['schedule'] })}
                  options={ScheduleFilter.map((s) => ({
                    value: s,
                    label: t(`filters.schedule.${s}`),
                  }))}
                />
              )}
            </Field>
            <Field label={t('filters.createdFrom')}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  dir="ltr"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(e) => set({ from: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('filters.createdTo')}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  dir="ltr"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(e) => set({ to: e.target.value })}
                />
              )}
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
