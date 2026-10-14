import { Gauge } from 'lucide-react';
import type { ReadabilityReport } from '@contenter/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber, formatPercent } from '@/utils/format';

/** A bar that fills up to the limit (the mark); over the limit it turns warning-coloured. */
function Meter({
  label,
  value,
  limit,
  display,
  limitText,
}: {
  label: string;
  value: number;
  limit: number;
  display: string;
  limitText: string;
}) {
  const over = value > limit;
  // the mark sits at 2/3 of the bar, so there is room to show how far over the limit it is
  const width = Math.min(100, (value / (limit * 1.5)) * 100);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className={cn('tabular-nums', over && 'font-medium text-warning')}>
          {display}
          <span className="ms-2 text-xs text-muted-foreground">{limitText}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit * 1.5}
        aria-valuenow={value}
        className="relative h-2 rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', over ? 'bg-warning' : 'bg-primary/70')}
          style={{ width: `${width}%` }}
        />
        <span className="absolute inset-y-[-2px] start-2/3 w-px bg-foreground/40" />
      </div>
    </div>
  );
}

/**
 * Approximate readability of the current version (docs/47). Code counts the numbers; the card
 * only draws them against the platform's limits. It informs and never blocks anything.
 */
export function ReadabilityCard({
  readability,
}: {
  readability: ReadabilityReport | null | undefined;
}) {
  const t = useT();
  if (!readability) return null;
  const { metrics: m, limits, notes, enough } = readability;
  if (m.words === 0) return null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-4" />
            {t('contents.readability.title')}
          </span>
        }
        description={t('contents.readability.hint')}
      />
      <CardBody className="space-y-4">
        {!enough && (
          <p className="text-sm text-muted-foreground">{t('contents.readability.tooShort')}</p>
        )}
        <Meter
          label={t('contents.readability.avgSentence')}
          value={m.avgSentenceWords}
          limit={limits.avgSentenceWords}
          display={t('contents.readability.words', { n: formatNumber(m.avgSentenceWords, 1) })}
          limitText={t('contents.readability.upTo', { n: formatNumber(limits.avgSentenceWords) })}
        />
        <Meter
          label={t('contents.readability.longShare')}
          value={m.longSentenceShare}
          limit={limits.longSentenceShare}
          display={formatPercent(m.longSentenceShare, 0)}
          limitText={t('contents.readability.upTo', {
            n: formatPercent(limits.longSentenceShare, 0),
          })}
        />
        <Meter
          label={t('contents.readability.wordLength')}
          value={m.avgWordLetters}
          limit={limits.avgWordLetters}
          display={t('contents.readability.letters', { n: formatNumber(m.avgWordLetters, 1) })}
          limitText={t('contents.readability.upTo', { n: formatNumber(limits.avgWordLetters) })}
        />
        {enough && notes.length === 0 && (
          <p className="text-sm text-success">{t('contents.readability.ok')}</p>
        )}
        {notes.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {notes.map((n) => (
              <li key={n.code} className="rounded-md bg-warning/10 px-3 py-1.5 leading-6">
                {t(`contents.readability.codes.${n.code}`, {
                  ...Object.fromEntries(
                    Object.entries(n.params).map(([k, v]) => [
                      k,
                      typeof v === 'number' ? formatNumber(v, 1) : v,
                    ]),
                  ),
                })}
              </li>
            ))}
          </ul>
        )}
        {m.stiffPhrases.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground" dir="auto">
            {t('contents.readability.stiffFound')}{' '}
            {m.stiffPhrases.map((s) => `«${s.phrase}» ×${formatNumber(s.count)}`).join('، ')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
