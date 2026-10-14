import { Ruler } from 'lucide-react';
import type { Content, StyleFitRow } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { formatNumber, formatPercent } from '@/utils/format';

/**
 * Where the draft lies against the statistical range of the brand's examples (docs/53). It counts
 * lengths and marks; it never says the text "reads like" the brand, and it never blocks anything.
 * Without data there is no card; with too few samples it says so instead of guessing.
 */
export function StyleFitCard({ styleFit }: { styleFit: Content['styleFit'] }) {
  const t = useT();
  if (!styleFit) return null;
  if ('tooFew' in styleFit) {
    return (
      <Card>
        <CardHeader title={<Title />} description={t('styleFit.hint')} />
        <CardBody>
          <p className="text-sm text-muted-foreground">
            {t('styleFit.tooFew', {
              have: formatNumber(styleFit.basedOn),
              need: formatNumber(styleFit.needed),
            })}
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title={<Title />} description={t('styleFit.hint')} />
      <CardBody className="space-y-3">
        <p className="text-sm font-medium">
          {t('styleFit.summary', {
            inside: formatNumber(styleFit.inside),
            total: formatNumber(styleFit.total),
          })}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {t(`styleFit.source.${styleFit.source}`, { n: formatNumber(styleFit.basedOn) })}
          </span>
        </p>
        <ul className="space-y-1 text-sm">
          {styleFit.rows.map((r) => (
            <li key={r.metric} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{t(`styleFit.metrics.${r.metric}`)}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-muted-foreground">{valueText(r, t)}</span>
                <Badge tone={r.status === 'inside' ? 'success' : 'warning'}>
                  {t(`styleFit.status.${r.status}`)}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">{t('styleFit.note')}</p>
      </CardBody>
    </Card>
  );
}

function Title() {
  const t = useT();
  return (
    <span className="flex items-center gap-2">
      <Ruler className="size-4" />
      {t('styleFit.title')}
    </span>
  );
}

function valueText(r: StyleFitRow, t: ReturnType<typeof useT>): string {
  if (r.metric === 'question' || r.metric === 'cta') {
    const has = r.value === 1;
    const own = has ? t('styleFit.has') : t('styleFit.hasNot');
    return r.expected === undefined
      ? own
      : `${own} · ${t(r.expected ? 'styleFit.samplesAll' : 'styleFit.samplesNone')}`;
  }
  const fmt = (n: number) =>
    r.metric === 'persianShare' ? formatPercent(n, 0) : formatNumber(n, 1);
  return r.range ? `${fmt(r.value)} (${fmt(r.range.min)}–${fmt(r.range.max)})` : fmt(r.value);
}
