import { useUi } from '@/stores/ui';

const locale = () => (useUi.getState().lang === 'fa' ? 'fa-IR' : 'en-US');

export function formatDate(iso: string | Date | null | undefined, withTime = true) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

export function formatRelative(iso: string | null | undefined) {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(iso, false);
}

export function formatNumber(n: number | null | undefined, maxFraction = 0) {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: maxFraction }).format(n ?? 0);
}

export function formatUsd(n: number | null | undefined) {
  const v = n ?? 0;
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: v > 0 && v < 0.01 ? 4 : 2,
    maximumFractionDigits: v > 0 && v < 0.01 ? 4 : 2,
  }).format(v);
}

export function formatDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const s = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return s < 60
    ? `${formatNumber(s, 1)}s`
    : `${formatNumber(Math.floor(s / 60))}m ${formatNumber(Math.round(s % 60))}s`;
}
