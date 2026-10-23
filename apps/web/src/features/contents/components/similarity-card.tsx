import { Link } from 'react-router';
import { Copy, Files } from 'lucide-react';
import type { SimilarityMatch, SimilarityReport } from '@contenter/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatPercent } from '@/utils/format';

/** Where a match lives, so the title can link to it; null when there is no page to open. */
function hrefOf(m: SimilarityMatch): string | null {
  switch (m.kind) {
    case 'CONTENT':
      return paths.app.content.getHref(m.id);
    case 'IDEA':
      return m.topicId ? paths.app.topic.getHref(m.topicId, 'ideas') : null;
    case 'SAMPLE':
      return m.topicId ? paths.app.topic.getHref(m.topicId, 'samples') : null;
    case 'REFERENCE':
      return m.businessId ? paths.app.business.getHref(m.businessId) : null;
  }
}

/**
 * Literal similarity of the current version to other texts of the business (docs/48). Shown only
 * when something is similar; it warns and never blocks. A rewrite with the same meaning is not
 * caught, and the card says so.
 */
export function SimilarityCard({
  similarity,
}: {
  similarity: SimilarityReport | null | undefined;
}) {
  const t = useT();
  if (!similarity || similarity.level === 'NONE') return null;
  const copy = similarity.level === 'COPY';
  return (
    <Card className={cn(copy ? 'border-destructive/50' : 'border-warning/50')}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {copy ? (
              <Copy className="size-4 text-destructive" />
            ) : (
              <Files className="size-4 text-warning" />
            )}
            {t('contents.similarity.title')}
          </span>
        }
        description={t('contents.similarity.hint')}
      />
      <CardBody className="space-y-3">
        <p className="text-sm">
          {copy ? t('contents.similarity.copy') : t('contents.similarity.similar')}
        </p>
        <ul className="space-y-1.5 text-sm">
          {similarity.matches.map((m) => {
            const href = hrefOf(m);
            return (
              <li
                key={`${m.kind}-${m.id}`}
                className="flex items-baseline justify-between gap-3 rounded-md bg-muted px-3 py-1.5"
              >
                <span className="min-w-0" data-bidi="">
                  <span className="me-2 text-xs text-muted-foreground">
                    {t(`contents.similarity.kinds.${m.kind}`)}
                  </span>
                  {href ? (
                    <Link to={href} className="text-primary hover:underline">
                      {m.title}
                    </Link>
                  ) : (
                    m.title
                  )}
                </span>
                <span className="shrink-0 tabular-nums font-medium">
                  {formatPercent(m.score, 0)}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">{t('contents.similarity.limits')}</p>
      </CardBody>
    </Card>
  );
}
