import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import type { VariantItem } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { MarkdownView, PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatNumber, formatPercent } from '@/utils/format';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { usePickVariant, useVariantGroup } from '../api/variants';

/**
 * The drafts written together for one idea, side by side (docs/51-draft-variants.md). The numbers
 * under each draft are counted by code (length, quality warnings, sentence length, similarity to
 * the other drafts); choosing one sends the other still-draft ones to REJECTED, which can be undone.
 */
export function VariantsCompare({ contentId }: { contentId: string }) {
  const t = useT();
  const { data, isLoading } = useVariantGroup(contentId);
  const pick = usePickVariant(contentId);
  const editable = useCanEditTopic(data?.topicId);
  if (isLoading || !data) return <PageSpinner />;

  const generating = data.items.some((i) => i.status === 'GENERATING');
  const drafts = data.items.filter((i) => i.status === 'DRAFT' && i.body).length;
  const choose = (id: string) =>
    pick.mutate(id, {
      onSuccess: () => notify.success(t('variants.picked')),
      onError: (e) => notify.error(t('common.error'), e.message),
    });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to={paths.app.content.getHref(contentId)}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
            {t('variants.back')}
          </Link>
        }
        title={t('variants.title')}
        description={t('variants.subtitle')}
      />
      {generating && (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm">
          {t('variants.generating')}
        </p>
      )}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(data.items.length, 3)}, minmax(0, 1fr))` }}
      >
        {data.items.map((item) => (
          <Draft
            key={item.id}
            item={item}
            canPick={
              editable && item.status === 'DRAFT' && !!item.body && !generating && drafts >= 1
            }
            picking={pick.isPending && pick.variables === item.id}
            onPick={() => choose(item.id)}
          />
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('variants.pickHint')}</p>
    </>
  );
}

function Draft({
  item,
  canPick,
  picking,
  onPick,
}: {
  item: VariantItem;
  canPick: boolean;
  picking: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const over = item.maxChars !== null && item.length > item.maxChars;
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {item.angle ? t(`variants.angles.${item.angle}`) : t('variants.single')}
            <Badge tone={statusTone[item.status]}>{t(`enums.contentStatus.${item.status}`)}</Badge>
          </span>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-4">
        {item.status === 'GENERATING' ? (
          <p className="text-sm text-muted-foreground">{t('variants.stillWriting')}</p>
        ) : !item.body ? (
          <p className="text-sm text-muted-foreground">{t('variants.noText')}</p>
        ) : (
          <div className="space-y-2">
            <h3 className="font-semibold" data-bidi="">
              {item.title}
            </h3>
            <MarkdownView>{item.body}</MarkdownView>
            {item.cta && (
              <p
                className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
                data-bidi=""
              >
                👉 {item.cta}
              </p>
            )}
            {item.hashtags.length > 0 && (
              <p className="flex flex-wrap gap-2 text-sm text-primary" data-bidi="">
                {item.hashtags.map((h) => (
                  <span key={h}>{h.startsWith('#') ? h : `#${h}`}</span>
                ))}
              </p>
            )}
          </div>
        )}
        {item.body && (
          <dl className="mt-auto space-y-1 border-t pt-3 text-xs">
            <Metric
              label={t('variants.length')}
              value={
                item.maxChars === null
                  ? formatNumber(item.length)
                  : `${formatNumber(item.length)} / ${formatNumber(item.maxChars)}`
              }
              warn={over}
            />
            <Metric
              label={t('variants.warnings')}
              value={formatNumber(item.warnings)}
              warn={item.warnings > 0}
            />
            <Metric
              label={t('variants.sentence')}
              value={t('variants.words', { n: formatNumber(item.avgSentenceWords, 1) })}
              warn={item.readabilityNotes > 0}
            />
            <Metric
              label={t('variants.similar')}
              value={item.similarTo === null ? '—' : formatPercent(item.similarTo, 0)}
              warn={item.similarTo !== null && item.similarTo >= 0.55}
            />
          </dl>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={paths.app.content.getHref(item.id)}>{t('variants.open')}</Link>
          </Button>
          {canPick && (
            <Button size="sm" icon={<Check />} isLoading={picking} onClick={onPick}>
              {t('variants.pick')}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={warn ? 'font-medium text-warning' : undefined}>{value}</dd>
    </div>
  );
}
