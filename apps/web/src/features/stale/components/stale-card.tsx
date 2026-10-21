import { Link } from 'react-router';
import { CheckCircle2, Hourglass } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { formatDate, formatNumber } from '@/utils/format';
import { useStaleContents } from '../api/stale';

/**
 * Contents whose text no longer matches the business's key facts (docs/61). Found by the same
 * code as the quality gate; the card only lists them, it changes nothing.
 */
export function StaleCard({ businessId }: { businessId: string }) {
  const t = useT();
  const { data, isLoading } = useStaleContents(businessId);
  return (
    <Card data-testid="stale-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Hourglass className="size-4" />
            {t('stale.title')}
          </span>
        }
        description={t('stale.subtitle')}
        descriptionAsTip
      />
      <CardBody className="space-y-3">
        {isLoading && <Spinner />}
        {data && !data.items.length && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" />
            {data.checked
              ? t('stale.none', { count: formatNumber(data.checked) })
              : t('stale.nothingToCheck')}
          </p>
        )}
        {data?.truncated && <p className="text-xs text-muted-foreground">{t('stale.truncated')}</p>}
        {data?.items.map((c) => (
          <div key={c.id} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={paths.app.content.getHref(c.id)}
                className="font-medium hover:underline"
                dir="auto"
              >
                {c.title}
              </Link>
              <Badge tone={c.publishedAt ? 'danger' : 'outline'}>
                {c.publishedAt
                  ? t('stale.published', { date: formatDate(new Date(c.publishedAt)) })
                  : t(`enums.contentStatus.${c.status}`)}
              </Badge>
              <span className="text-xs text-muted-foreground" dir="auto">
                {c.topic.title}
              </span>
            </div>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {c.issues.map((i, n) => (
                <li key={n}>
                  {t(`contents.quality.codes.${i.code}`, {
                    ...Object.fromEntries(
                      Object.entries(i.params).map(([k, v]) => [
                        k,
                        typeof v === 'number' ? formatNumber(v) : v,
                      ]),
                    ),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
