import { Package } from 'lucide-react';
import {
  DEFAULT_OFFERING_STALE_DAYS,
  type OfferingCoverageReport,
  type OfferingMatrixCell,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import { useOfferingCoverage } from '../api/coverage';

/** Indent of a variant under its line (logical, so it follows RTL). */
const DEPTH_INDENT = ['', 'ps-4', 'ps-8'] as const;

/**
 * Which products and services — and which product × audience pairs — approved or published content
 * covered lately (docs/73). Counted by code from the focus people set; an offering that cannot be
 * sold or is not to be pushed is never called uncovered.
 */
export function OfferingCoverageCard({ businessId }: { businessId: string }) {
  const t = useT();
  const { data, isLoading } = useOfferingCoverage(businessId, DEFAULT_OFFERING_STALE_DAYS);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Package className="size-4" />
            {t('coverage.offerings.title')}
          </span>
        }
        description={t('coverage.offerings.subtitle', { days: formatNumber(DEFAULT_OFFERING_STALE_DAYS) })}
        descriptionAsTip
      />
      <CardBody className="space-y-6">
        {isLoading || !data ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : data.rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('coverage.offerings.empty')}</p>
        ) : (
          <>
            <OfferingTable report={data} />
            <Matrix report={data} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function OfferingTable({ report }: { report: OfferingCoverageReport }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-start font-medium">{t('coverage.offerings.offering')}</th>
            {report.windows.map((w) => (
              <th key={w} className="px-2 py-2 text-center font-medium">
                {t('coverage.lastDays', { n: formatNumber(w) })}
              </th>
            ))}
            <th className="px-2 py-2 text-start font-medium">{t('coverage.offerings.last')}</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.offeringId} className="border-b last:border-0">
              <td className={cn('py-2', DEPTH_INDENT[r.depth] ?? DEPTH_INDENT[2])} data-bidi="">
                <span className="flex flex-wrap items-center gap-2">
                  {r.name}
                  {r.stale && <Badge tone="warning">{t('coverage.offerings.stale')}</Badge>}
                  {!r.promotable && <Badge tone="neutral">{t('coverage.offerings.notPromotable')}</Badge>}
                </span>
              </td>
              {report.windows.map((w) => (
                <td key={w} className="px-2 py-2 text-center tabular-nums">
                  {formatNumber(r.subtree[w])}
                  {r.subtree[w] !== r.own[w] && (
                    <span className="ms-1 text-xs text-muted-foreground">
                      ({t('coverage.offerings.own', { n: formatNumber(r.own[w]) })})
                    </span>
                  )}
                </td>
              ))}
              <td className="px-2 py-2 text-xs text-muted-foreground">
                {r.daysSince === null
                  ? t('coverage.offerings.never')
                  : t('coverage.offerings.daysAgo', { n: formatNumber(r.daysSince) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.withoutOffering[90] > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('coverage.offerings.withoutOffering', { n: formatNumber(report.withoutOffering[90]) })}
        </p>
      )}
    </div>
  );
}

function Matrix({ report }: { report: OfferingCoverageReport }) {
  const t = useT();
  if (!report.segments.length) return null;
  const cell = new Map<string, OfferingMatrixCell>(report.cells.map((c) => [`${c.offeringId}:${c.segmentId}`, c]));
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{t('coverage.offerings.matrix')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('coverage.offerings.matrixHint', { n: formatNumber(report.windows[report.windows.length - 1] ?? 90) })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-start font-medium">{t('coverage.offerings.offering')}</th>
              {report.segments.map((s) => (
                <th key={s.id} className="px-2 py-2 text-center font-medium" data-bidi="">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.offeringId} className="border-b last:border-0">
                <td className={cn('py-2', DEPTH_INDENT[r.depth] ?? DEPTH_INDENT[2])} data-bidi="">
                  {r.name}
                </td>
                {report.segments.map((s) => (
                  <MatrixCell key={s.id} cell={cell.get(`${r.offeringId}:${s.id}`)} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.withoutAudience > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('coverage.offerings.withoutAudience', { n: formatNumber(report.withoutAudience) })}
        </p>
      )}
    </section>
  );
}

function MatrixCell({ cell }: { cell: OfferingMatrixCell | undefined }) {
  const t = useT();
  if (!cell) return <td className="px-2 py-2 text-center text-muted-foreground">·</td>;
  return (
    <td
      className={cn(
        'px-2 py-2 text-center tabular-nums',
        cell.gap && 'bg-warning/10 font-semibold',
        !cell.linked && 'text-muted-foreground',
      )}
      title={
        cell.gap
          ? t('coverage.offerings.gap')
          : cell.linked
            ? t(cell.fit === 2 ? 'businesses.offerings.fields.fitMain' : 'businesses.offerings.fields.fitSecondary')
            : t('coverage.offerings.notLinked')
      }
    >
      {formatNumber(cell.count)}
      {cell.gap && <span className="ms-1 text-xs">!</span>}
    </td>
  );
}
