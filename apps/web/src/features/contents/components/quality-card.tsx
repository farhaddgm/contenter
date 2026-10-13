import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { QualityIssue, QualityReport } from '@contenter/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { formatNumber } from '@/utils/format';

/** Brand terminology has its own card (with the AI fix); this card shows every other check. */
const OWN_CARD = new Set(['TERM_AVOID', 'TERM_USE']);

/**
 * Pre-publish quality gate (docs/31). The report is computed by code on the server; the card only
 * words it. It warns and never blocks a review step.
 */
export function QualityCard({ quality }: { quality: QualityReport | null | undefined }) {
  const t = useT();
  if (!quality) return null;
  const issues = quality.issues.filter((i) => !OWN_CARD.has(i.code));
  const warnings = issues.filter((i) => i.severity === 'warn');
  const infos = issues.filter((i) => i.severity === 'info');
  const { maxChars } = quality.rules;

  const line = (i: QualityIssue) =>
    t(`contents.quality.codes.${i.code}`, {
      ...Object.fromEntries(
        Object.entries(i.params).map(([k, v]) => [
          k,
          typeof v === 'number' ? formatNumber(v) : v,
        ]),
      ),
    });

  return (
    <Card className={warnings.length ? 'border-warning/50' : undefined}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {warnings.length ? (
              <AlertTriangle className="size-4 text-warning" />
            ) : (
              <CheckCircle2 className="size-4 text-success" />
            )}
            {t('contents.quality.title')}
          </span>
        }
        description={t('contents.quality.hint')}
      />
      <CardBody className="space-y-3">
        {!issues.length && <p className="text-sm text-success">{t('contents.quality.ok')}</p>}
        {warnings.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {warnings.map((i, n) => (
              <li key={n} className="rounded-md bg-warning/10 px-3 py-1.5 leading-6">
                {line(i)}
              </li>
            ))}
          </ul>
        )}
        {infos.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {infos.map((i, n) => (
              <li
                key={n}
                className="flex gap-2 rounded-md bg-muted px-3 py-1.5 leading-6 text-muted-foreground"
              >
                <Info className="mt-1 size-3.5 shrink-0" />
                <span>{line(i)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          {maxChars
            ? t('contents.quality.length', {
                length: formatNumber(quality.length),
                max: formatNumber(maxChars),
                confidence: t(`contents.quality.confidence.${quality.rules.confidence}`),
              })
            : t('contents.quality.noLimit', { length: formatNumber(quality.length) })}
        </p>
      </CardBody>
    </Card>
  );
}
