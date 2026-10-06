import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BookOpen, Building2, FileSearch, Layers, ShieldCheck } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import { useTopicAiContext } from '../api/brand-docs';

function Source({
  icon,
  label,
  value,
  usedIn,
  to,
  empty,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  usedIn: string;
  to: string;
  empty: boolean;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex h-full items-start gap-3 rounded-md p-3 transition hover:bg-muted [&_svg]:size-4"
      >
        <span className={cn('mt-0.5', empty ? 'text-muted-foreground' : 'text-primary')}>
          {icon}
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className="block text-xs text-muted-foreground">{label}</span>
          <span className={cn('block text-sm font-medium', empty && 'text-muted-foreground')}>
            {value}
          </span>
          <span className="block text-[11px] text-muted-foreground">{usedIn}</span>
        </span>
      </Link>
    </li>
  );
}

/** Shows which sources the topic's AI jobs receive as context, with links to manage them. */
export function AiContextCard({ topicId }: { topicId: string }) {
  const t = useT();
  const { data } = useTopicAiContext(topicId);
  if (!data) return null;
  const principles = data.topicPrinciples + data.globalPrinciples;
  const used = (jobs: string) => t('aiContext.usedIn', { jobs });

  return (
    <Card>
      <CardHeader title={t('aiContext.title')} description={t('aiContext.subtitle')} />
      <ul className="grid gap-1 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Source
          icon={<Building2 />}
          label={t('aiContext.business')}
          value={
            data.business
              ? t(
                  data.business.references
                    ? 'aiContext.businessValueDocs'
                    : 'aiContext.businessValue',
                  {
                    name: data.business.name,
                    filled: formatNumber(data.business.filledSections),
                    docs: formatNumber(data.business.references),
                  },
                )
              : t('aiContext.none')
          }
          usedIn={used(t('aiContext.jobsEverything'))}
          to={
            data.business
              ? paths.app.business.getHref(data.business.id)
              : paths.app.businesses.getHref()
          }
          empty={!data.business}
        />
        <Source
          icon={<FileSearch />}
          label={t('aiContext.samples')}
          value={
            data.samplesSkipped && !data.analyzedSamples
              ? t('aiContext.samplesSkipped')
              : formatNumber(data.analyzedSamples)
          }
          usedIn={used(t('aiContext.jobsProfile'))}
          to={paths.app.topic.getHref(topicId, 'samples')}
          empty={!data.analyzedSamples && !data.samplesSkipped}
        />
        <Source
          icon={<ShieldCheck />}
          label={t('aiContext.principles')}
          value={t('aiContext.principlesValue', {
            topic: formatNumber(data.topicPrinciples),
            global: formatNumber(data.globalPrinciples),
          })}
          usedIn={used(t('aiContext.jobsAll'))}
          to={paths.app.topic.getHref(topicId, 'principles')}
          empty={!principles}
        />
        <Source
          icon={<BookOpen />}
          label={t('aiContext.brandDocs')}
          value={
            data.brandDocs.length
              ? data.brandDocs.map((d) => d.title).join(' · ')
              : t('aiContext.none')
          }
          usedIn={used(t('aiContext.jobsAll'))}
          to={paths.app.topic.getHref(topicId, 'principles')}
          empty={!data.brandDocs.length}
        />
        <Source
          icon={<Layers />}
          label={t('aiContext.activeProfile')}
          value={
            data.activeProfile
              ? t('aiContext.profileValue', {
                  version: formatNumber(data.activeProfile.version),
                  traits: formatNumber(data.activeProfile.approvedTraits),
                })
              : t('aiContext.none')
          }
          usedIn={used(t('aiContext.jobsGeneration'))}
          to={paths.app.topic.getHref(topicId, 'profile')}
          empty={!data.activeProfile}
        />
      </ul>
    </Card>
  );
}
