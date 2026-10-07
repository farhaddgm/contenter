import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FileText, FolderKanban, Lightbulb, Search } from 'lucide-react';
import type { SearchHit } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/ui/misc';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { formatNumber } from '@/utils/format';
import { TagChips } from '@/features/tags/components/tag-chip';
import { MIN_SEARCH_LENGTH, useSearch } from '../api/search';
import { Highlight } from './highlight';

type Kind = 'contents' | 'ideas' | 'topics';

function hrefOf(kind: Kind, hit: SearchHit): string {
  if (kind === 'contents') return paths.app.content.getHref(hit.id);
  if (kind === 'ideas') return paths.app.topic.getHref(hit.topic?.id ?? '', 'ideas');
  return paths.app.topic.getHref(hit.id);
}

function HitCard({ kind, hit, terms }: { kind: Kind; hit: SearchHit; terms: string[] }) {
  const t = useT();
  return (
    <li>
      <Link
        to={hrefOf(kind, hit)}
        className="block space-y-1.5 px-4 py-3 transition hover:bg-muted/50"
      >
        <p className="font-medium leading-6" dir="auto">
          <Highlight text={hit.title} terms={terms} />
        </p>
        {hit.snippet && (
          <p className="line-clamp-2 text-sm leading-6 text-muted-foreground" dir="auto">
            <Highlight text={hit.snippet} terms={terms} />
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {hit.topic && kind !== 'topics' && (
            <span className="text-muted-foreground" dir="auto">
              {hit.topic.title}
            </span>
          )}
          {hit.status && (
            <Badge tone={statusTone[hit.status]}>
              {kind === 'contents'
                ? t(`enums.contentStatus.${hit.status as 'DRAFT'}`)
                : kind === 'ideas'
                  ? t(`enums.ideaStatus.${hit.status as 'PROPOSED'}`)
                  : t(`enums.topicStatus.${hit.status as 'ACTIVE'}`)}
            </Badge>
          )}
          {hit.format && <Badge tone="outline">{t(`enums.contentFormat.${hit.format}`)}</Badge>}
          {hit.platform && <Badge tone="primary">{t(`enums.platform.${hit.platform}`)}</Badge>}
          <TagChips tags={hit.tags} />
        </div>
      </Link>
    </li>
  );
}

function Group({
  kind,
  title,
  icon,
  hits,
  terms,
}: {
  kind: Kind;
  title: string;
  icon: ReactNode;
  hits: SearchHit[];
  terms: string[];
}) {
  if (!hits.length) return null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {icon}
            {title}
            <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {formatNumber(hits.length)}
            </span>
          </span>
        }
      />
      <ul className="divide-y">
        {hits.map((h) => (
          <HitCard key={h.id} kind={kind} hit={h} terms={terms} />
        ))}
      </ul>
    </Card>
  );
}

/** Results for the words in `?q=`, across contents, ideas and topics. */
export function SearchPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const typed = useDebounce(text).trim();

  // the URL follows the typing, so a search can be shared and reloaded
  useEffect(() => {
    if (typed.length >= MIN_SEARCH_LENGTH && typed !== q.trim()) {
      setParams({ q: typed }, { replace: true });
    }
    // `q` is the URL's own value; only a pause in typing should write it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const { data, isFetching } = useSearch(q);
  const total =
    (data?.contents.length ?? 0) + (data?.ideas.length ?? 0) + (data?.topics.length ?? 0);
  const tooShort = q.trim().length < MIN_SEARCH_LENGTH;

  return (
    <>
      <PageHeader title={t('search.title')} description={t('search.subtitle')} />
      <div className="relative mb-4 max-w-xl">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          dir="auto"
          className="ps-9"
          placeholder={t('search.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {tooShort ? (
        <Card>
          <EmptyState icon={<Search />} title={t('search.hint')} />
        </Card>
      ) : !data ? (
        <PageSpinner />
      ) : total === 0 ? (
        <Card>
          <EmptyState
            icon={<Search />}
            title={t('search.none', { q })}
            description={t('search.noneHint')}
          />
        </Card>
      ) : (
        <div className="space-y-4" aria-busy={isFetching}>
          <Group
            kind="contents"
            title={t('search.contents')}
            icon={<FileText className="size-4" />}
            hits={data.contents}
            terms={data.terms}
          />
          <Group
            kind="ideas"
            title={t('search.ideas')}
            icon={<Lightbulb className="size-4" />}
            hits={data.ideas}
            terms={data.terms}
          />
          <Group
            kind="topics"
            title={t('search.topics')}
            icon={<FolderKanban className="size-4" />}
            hits={data.topics}
            terms={data.terms}
          />
        </div>
      )}
    </>
  );
}
