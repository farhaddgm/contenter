import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, GripVertical } from 'lucide-react';
import { calendarMomentOf, type CalendarItem, type CalendarState } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form-controls';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useUi } from '@/stores/ui';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import {
  addDays,
  dayKey,
  monthGrid,
  monthTitle,
  moveToDay,
  nextMonthStart,
  prevMonthStart,
  systemFor,
  weekdayLabels,
  weekGrid,
  type GridDay,
} from '@/utils/calendar';
import { formatDate, formatNumber } from '@/utils/format';
import { useCampaigns } from '@/features/campaigns/api/campaigns';
import { useCanEditTopic, useTopics } from '@/features/topics/api/topics';
import { TagChips } from '@/features/tags/components/tag-chip';
import { useCalendar, useScheduleAny } from '../api/calendar';
import { SchedulePanel } from './schedule-panel';

const DRAG_TYPE = 'application/x-contenter-content';
/** How many items a month cell shows before "+N more". */
const MONTH_CELL_LIMIT = 3;

const STATE_STYLE: Record<CalendarState | 'READY', string> = {
  SCHEDULED: 'border-primary/30 bg-primary/10 text-primary',
  OVERDUE: 'border-destructive/40 bg-destructive/10 text-destructive',
  PUBLISHED: 'border-success/40 bg-success/10 text-success',
  READY: 'border-border bg-card text-foreground',
};

function timeOf(item: CalendarItem): string {
  const at = calendarMomentOf(item);
  return at
    ? new Intl.DateTimeFormat(useUi.getState().lang === 'fa' ? 'fa-IR' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(at)
    : '';
}

function ItemChip({
  item,
  onOpen,
  showTime = true,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  showTime?: boolean;
}) {
  const t = useT();
  const draggable = item.state !== 'PUBLISHED';
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(item)}
      title={`${item.title} — ${t(`enums.platform.${item.topic.platform}`)}`}
      className={cn(
        'flex w-full items-start gap-1 rounded-md border px-1.5 py-1 text-start text-xs leading-4 transition hover:brightness-95',
        STATE_STYLE[item.state ?? 'READY'],
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {draggable && <GripVertical className="mt-0.5 size-3 shrink-0 opacity-50" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate" dir="auto">
          {item.title}
        </span>
        {showTime && item.state && (
          <span className="block text-[10px] tabular-nums opacity-70">{timeOf(item)}</span>
        )}
      </span>
    </button>
  );
}

function DayCell({
  day,
  items,
  isToday,
  limit,
  onOpen,
  onDropItem,
  onMore,
}: {
  day: GridDay;
  items: CalendarItem[];
  isToday: boolean;
  limit: number;
  onOpen: (item: CalendarItem) => void;
  onDropItem: (id: string, day: GridDay) => void;
  onMore: (day: GridDay) => void;
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  const shown = items.slice(0, limit);
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id) {
          e.preventDefault();
          onDropItem(id, day);
        }
      }}
      data-day={day.key}
      className={cn(
        'flex min-h-28 flex-col gap-1 border-b border-e p-1.5 transition-colors',
        !day.inMonth && 'bg-muted/40 text-muted-foreground',
        over && 'bg-primary/10 ring-2 ring-inset ring-primary/40',
      )}
    >
      <span
        className={cn(
          'flex size-6 items-center justify-center self-start rounded-full text-xs tabular-nums',
          isToday && 'bg-primary font-semibold text-primary-foreground',
        )}
      >
        {formatNumber(day.day)}
      </span>
      {shown.map((item) => (
        <ItemChip key={item.id} item={item} onOpen={onOpen} />
      ))}
      {items.length > limit && (
        <button
          type="button"
          onClick={() => onMore(day)}
          className="px-1 text-start text-[11px] text-muted-foreground hover:text-foreground"
        >
          {t('calendar.more', { count: formatNumber(items.length - limit) })}
        </button>
      )}
    </div>
  );
}

/** Mounted only while open, so it starts from the chosen item. */
function ItemDialog({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const t = useT();
  const editable = useCanEditTopic(item.topic.id);
  const moment = calendarMomentOf(item);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={<span dir="auto">{item.title}</span>}
      description={`${item.topic.title} · ${t(`enums.platform.${item.topic.platform}`)} · ${t(`enums.contentFormat.${item.format}`)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button asChild icon={<ExternalLink />}>
            <Link to={paths.app.content.getHref(item.id)}>{t('calendar.openContent')}</Link>
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {item.state && (
            <Badge
              tone={
                item.state === 'PUBLISHED'
                  ? 'success'
                  : item.state === 'OVERDUE'
                    ? 'danger'
                    : 'primary'
              }
            >
              {t(`calendar.state.${item.state}`)}
            </Badge>
          )}
          {moment && <span className="text-muted-foreground">{formatDate(moment)}</span>}
          {item.campaign && <Badge tone="outline">{item.campaign.name}</Badge>}
        </div>
        <TagChips tags={item.tags} />
        <SchedulePanel content={item} editable={editable} />
      </div>
    </Dialog>
  );
}

/** The content calendar: month or week, Jalali in Persian, with drag-to-reschedule. */
export function CalendarView() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const system = systemFor(lang);
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [topicId, setTopicId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  // the dialog shows the live item, so a plan saved inside it is reflected right away
  const [openedId, setOpenedId] = useState<string | null>(null);
  const schedule = useScheduleAny();
  const { data: topics } = useTopics({ page: 1, pageSize: 100, status: 'ACTIVE' });
  const { data: campaigns } = useCampaigns(topicId || undefined);

  const grid = useMemo(
    () => (view === 'month' ? monthGrid(anchor, system) : weekGrid(anchor, system)),
    [anchor, system, view],
  );
  const { data, isLoading } = useCalendar({
    from: grid.from.toISOString(),
    to: grid.to.toISOString(),
    topicId: topicId || undefined,
    campaignId: campaignId || undefined,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of data?.items ?? []) {
      const at = calendarMomentOf(item);
      if (!at) continue;
      const list = map.get(dayKey(at)) ?? [];
      list.push(item);
      map.set(dayKey(at), list);
    }
    return map;
  }, [data]);
  const known = useMemo(
    () => new Map([...(data?.items ?? []), ...(data?.ready ?? [])].map((i) => [i.id, i])),
    [data],
  );

  const opened = openedId ? known.get(openedId) : undefined;
  const today = dayKey(new Date());
  const step = (dir: 1 | -1) =>
    setAnchor(
      view === 'month'
        ? dir === 1
          ? nextMonthStart(anchor, system)
          : prevMonthStart(anchor, system)
        : addDays(anchor, 7 * dir),
    );

  const drop = (id: string, day: GridDay) => {
    const item = known.get(id);
    if (!item || item.state === 'PUBLISHED') return;
    const at = moveToDay(day.date, calendarMomentOf(item));
    schedule.mutate(
      { id, scheduledAt: at.toISOString() },
      {
        onSuccess: () => notify.success(t('calendar.moved', { date: formatDate(at) })),
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );
  };

  const weekdays = weekdayLabels(lang);
  // the fixed width of the grid keeps cells readable; the page scrolls sideways on a phone
  const columns = 'grid grid-cols-7';

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        description={t('calendar.subtitle')}
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: t('calendar.month') },
              { value: 'week', label: t('calendar.week') },
            ]}
          />
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_16rem]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t('common.previous')}
              onClick={() => step(-1)}
            >
              <ChevronRight className="rtl:inline ltr:hidden" />
              <ChevronLeft className="ltr:inline rtl:hidden" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t('common.next')}
              onClick={() => step(1)}
            >
              <ChevronLeft className="rtl:inline ltr:hidden" />
              <ChevronRight className="ltr:inline rtl:hidden" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
              {t('calendar.today')}
            </Button>
            <h2 className="mx-2 min-w-32 text-base font-semibold">{monthTitle(anchor, lang)}</h2>
            <div className="flex-1" />
            <Select
              className="h-8 w-44 text-xs"
              aria-label={t('contents.topic')}
              placeholder={t('calendar.allTopics')}
              value={topicId}
              onChange={(e) => {
                setTopicId(e.target.value);
                setCampaignId('');
              }}
              options={(topics?.items ?? []).map((tp) => ({ value: tp.id, label: tp.title }))}
            />
            {topicId && !!campaigns?.length && (
              <Select
                className="h-8 w-40 text-xs"
                aria-label={t('campaigns.one')}
                placeholder={t('campaigns.allCampaigns')}
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[44rem]">
              <div
                className={cn(
                  columns,
                  'border-b bg-muted/40 text-center text-xs text-muted-foreground',
                )}
              >
                {weekdays.map((w) => (
                  <div key={w} className="border-e py-2">
                    {w}
                  </div>
                ))}
              </div>
              <div className={cn(columns, isLoading && 'opacity-60')} data-testid="calendar-grid">
                {grid.days.map((day) => (
                  <DayCell
                    key={day.key}
                    day={day}
                    items={byDay.get(day.key) ?? []}
                    isToday={day.key === today}
                    limit={view === 'month' ? MONTH_CELL_LIMIT : 20}
                    onOpen={(i) => setOpenedId(i.id)}
                    onDropItem={drop}
                    onMore={(d) => {
                      setAnchor(d.date);
                      setView('week');
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground">
            {(['SCHEDULED', 'OVERDUE', 'PUBLISHED'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn('size-3 rounded border', STATE_STYLE[s])} />
                {t(`calendar.state.${s}`)}
              </span>
            ))}
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4" />
                {t('calendar.ready')}
              </span>
            }
            description={t('calendar.readyHint')}
          />
          <div className="space-y-1.5 p-3">
            {!data?.ready.length ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                {t('calendar.readyEmpty')}
              </p>
            ) : (
              data.ready.map((item) => (
                <div key={item.id} className="space-y-0.5">
                  <ItemChip item={item} onOpen={(i) => setOpenedId(i.id)} showTime={false} />
                  <p className="px-1 text-[11px] text-muted-foreground" dir="auto">
                    {item.topic.title}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {opened && <ItemDialog item={opened} onClose={() => setOpenedId(null)} />}
    </>
  );
}
