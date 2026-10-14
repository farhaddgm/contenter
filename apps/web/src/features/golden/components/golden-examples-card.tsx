import { Link } from 'react-router';
import { Award } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { formatNumber, formatRelative } from '@/utils/format';
import { useGoldenExamples } from '../api/golden';

/**
 * The golden examples of a business (docs/49): what the model may read as the brand's voice when
 * it writes a draft, so the admin can see what it was given.
 */
export function GoldenExamplesCard({ businessId }: { businessId: string }) {
  const t = useT();
  const { data, isLoading } = useGoldenExamples(businessId);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Award className="size-4" />
            {t('golden.listTitle')}
          </span>
        }
        description={
          data
            ? t('golden.listHint', {
                max: formatNumber(data.maxExamples),
                chars: formatNumber(data.maxChars),
              })
            : undefined
        }
      />
      <CardBody>
        {isLoading || !data ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : data.maxExamples === 0 ? (
          <p className="text-sm text-muted-foreground">{t('golden.off')}</p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('golden.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {data.items.map((g) => (
              <li key={g.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={paths.app.content.getHref(g.id)}
                    className="font-medium text-primary hover:underline"
                    dir="auto"
                  >
                    {g.title}
                  </Link>
                  <Badge tone="neutral">{t(`enums.platform.${g.platform}`)}</Badge>
                  {!g.eligible && <Badge tone="warning">{t('golden.notEligible')}</Badge>}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {formatRelative(g.goldenAt)}
                  </span>
                </div>
                {g.excerpt && (
                  <p className="mt-1.5 line-clamp-3 leading-6 text-muted-foreground" dir="auto">
                    {g.excerpt}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
