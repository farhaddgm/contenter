import { useState } from 'react';
import { Wallet } from 'lucide-react';
import {
  budgetLevel,
  type BudgetCalendar,
  type BudgetLevel,
  type BudgetResponse,
  type BudgetSettings,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatNumber, formatPercent, formatUsd } from '@/utils/format';
import { useBudget, useUpdateBudget } from '@/features/admin/api';
import { useBusinessOptions } from '@/features/businesses/api/businesses';

const BAR: Record<BudgetLevel, string> = {
  none: 'bg-muted-foreground/30',
  ok: 'bg-success',
  warning: 'bg-warning',
  exceeded: 'bg-destructive',
};

function Bar({ level, percent }: { level: BudgetLevel; percent: number | null }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full transition-all', BAR[level])}
        style={{ width: `${Math.min(100, Math.round((percent ?? 0) * 100))}%` }}
      />
    </div>
  );
}

const toNumber = (v: string): number | null => {
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
};

/** Monthly AI budget (docs/60-reliability-and-cost.md): cap, warning level, hard stop, usage. */
export function BudgetCard() {
  const t = useT();
  const { data } = useBudget();
  return (
    <Card data-testid="budget-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Wallet className="size-4" />
            {t('settings.budget.title')}
          </span>
        }
        description={t('settings.budget.subtitle')}
        descriptionAsTip
      />
      <CardBody>{!data ? <Spinner /> : <BudgetForm data={data} />}</CardBody>
    </Card>
  );
}

/** Mounted once the data is there, so the inputs start from it without a reset effect. */
function BudgetForm({ data }: { data: BudgetResponse }) {
  const t = useT();
  const save = useUpdateBudget();
  const options = useBusinessOptions();
  const [form, setForm] = useState<BudgetSettings>(data.settings);
  const [cap, setCap] = useState(
    data.settings.monthlyUsd === null ? '' : String(data.settings.monthlyUsd),
  );
  const [addId, setAddId] = useState('');
  const u = data.usage;

  const setBusinessCap = (id: string, value: string) =>
    setForm((f) => {
      const businesses = { ...f.businesses };
      const n = toNumber(value);
      if (n === null) delete businesses[id];
      else businesses[id] = n;
      return { ...f, businesses };
    });

  const listed = new Set([
    ...u.byBusiness.map((b) => b.businessId),
    ...Object.keys(form.businesses),
  ]);
  const addable = (options.data ?? []).filter((b) => !listed.has(b.id));
  const nameOf = (id: string) =>
    u.byBusiness.find((b) => b.businessId === id)?.name ??
    options.data?.find((b) => b.id === id)?.name ??
    id;
  const level = budgetLevel(u.spentUsd, form.monthlyUsd, form.warnPercent);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{t('settings.budget.thisMonth', { label: u.label })}</span>
          <span className="tabular-nums" dir="ltr">
            {formatUsd(u.spentUsd)}
            {u.capUsd !== null && ` / ${formatUsd(u.capUsd)}`}
            {u.percent !== null && ` (${formatPercent(u.percent, 0)})`}
          </span>
        </div>
        <Bar level={u.level} percent={u.percent} />
        <p className="text-xs text-muted-foreground">{t(`settings.budget.level.${u.level}`)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.budget.cap')} hint={t('settings.budget.capHint')}>
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              type="number"
              min={0}
              step="0.5"
              value={cap}
              placeholder={t('settings.budget.noCap')}
              onChange={(e) => {
                setCap(e.target.value);
                setForm({ ...form, monthlyUsd: toNumber(e.target.value) });
              }}
            />
          )}
        </Field>
        <Field label={t('settings.budget.warnAt')}>
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              type="number"
              min={1}
              max={100}
              value={form.warnPercent}
              onChange={(e) =>
                setForm({
                  ...form,
                  warnPercent: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))),
                })
              }
            />
          )}
        </Field>
        <Field label={t('settings.budget.calendar')}>
          {(id) => (
            <Select
              id={id}
              value={form.calendar}
              onChange={(e) => setForm({ ...form, calendar: e.target.value as BudgetCalendar })}
              options={[
                { value: 'persian', label: t('settings.budget.persian') },
                { value: 'gregory', label: t('settings.budget.gregory') },
              ]}
            />
          )}
        </Field>
        <div className="space-y-1.5">
          <Switch
            checked={form.hardStop}
            onCheckedChange={(hardStop) => setForm({ ...form, hardStop })}
            label={t('settings.budget.hardStop')}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {form.hardStop ? t('settings.budget.hardStopOn') : t('settings.budget.hardStopOff')}
          </p>
        </div>
      </div>
      {level === 'exceeded' && form.hardStop && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
          {t('settings.budget.blockedNow')}
        </p>
      )}

      {u.byTask.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('settings.budget.byTask')}</p>
          <ul className="divide-y rounded-md border text-sm">
            {u.byTask.slice(0, 6).map((row) => (
              <li key={row.type} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{t(`enums.jobType.${row.type}`)}</span>
                <span className="text-muted-foreground tabular-nums" dir="ltr">
                  {formatUsd(row.usd)} · {formatNumber(row.jobs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('settings.budget.byBusiness')}</p>
        {listed.size === 0 && (
          <p className="text-xs text-muted-foreground">{t('settings.budget.noBusiness')}</p>
        )}
        <ul className="space-y-2">
          {[...listed].map((id) => {
            const line = u.byBusiness.find((b) => b.businessId === id);
            const spent = line?.usd ?? 0;
            const bCap = form.businesses[id];
            const lvl = budgetLevel(spent, bCap, form.warnPercent);
            return (
              <li key={id} className="space-y-1.5 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{nameOf(id)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground tabular-nums" dir="ltr">
                      {formatUsd(spent)} /
                    </span>
                    <Input
                      dir="ltr"
                      type="number"
                      min={0}
                      step="0.5"
                      className="h-8 w-24"
                      aria-label={`${t('settings.budget.businessCap')} — ${nameOf(id)}`}
                      value={bCap ?? ''}
                      placeholder="—"
                      onChange={(e) => setBusinessCap(id, e.target.value)}
                    />
                  </span>
                </div>
                {bCap !== undefined && bCap > 0 && <Bar level={lvl} percent={spent / bCap} />}
              </li>
            );
          })}
        </ul>
        {addable.length > 0 && (
          <div className="flex gap-2">
            <Select
              className="flex-1"
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              placeholder={t('settings.budget.addBusiness')}
              options={addable.map((b) => ({ value: b.id, label: b.name }))}
            />
            <Button
              variant="outline"
              disabled={!addId}
              onClick={() => {
                setForm({ ...form, businesses: { ...form.businesses, [addId]: 10 } });
                setAddId('');
              }}
            >
              {t('settings.add')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          isLoading={save.isPending}
          onClick={() =>
            save.mutate(form, {
              onSuccess: () => notify.success(t('common.saved')),
              onError: (e) => notify.error(t('common.error'), e.message),
            })
          }
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
