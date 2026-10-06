import { Link } from 'react-router';
import { CheckCircle2, Circle } from 'lucide-react';
import type { Topic } from '@contenter/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { useSamples } from '@/features/samples/api/samples';

export function TopicOverview({ topic }: { topic: Topic }) {
  const t = useT();
  const samples = useSamples(topic.id);
  const analyzed = samples.data?.some((s) => s.analysisStatus === 'DONE') ?? false;
  // Sample contents are optional: skipping settles both sample steps (docs/19-optional-samples.md).
  const skipped = !!topic.samplesSkippedAt;
  const sampleCount = topic._count?.samples ?? 0;
  const steps = [
    {
      done: skipped || sampleCount > 0,
      skipped: skipped && sampleCount === 0,
      label: t('topics.steps.samples'),
      tab: 'samples',
    },
    {
      done: skipped || analyzed,
      skipped: skipped && !analyzed,
      label: t('topics.steps.analyze'),
      tab: 'samples',
    },
    { done: !!topic.activeProfileId, label: t('topics.steps.profile'), tab: 'profile' },
    { done: (topic._count?.ideas ?? 0) > 0, label: t('topics.steps.ideas'), tab: 'ideas' },
    { done: (topic._count?.contents ?? 0) > 0, label: t('topics.steps.contents'), tab: 'contents' },
  ];
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader title={t('topics.fields.description')} />
        <CardBody className="space-y-5">
          <p className="whitespace-pre-wrap text-sm leading-8">{topic.description}</p>
          {topic.audience && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                {t('topics.fields.audience')}
              </h4>
              <p className="text-sm leading-7">{topic.audience}</p>
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title={t('topics.workflow')} />
        <ol className="p-3">
          {steps.map((s, i) => (
            <li key={i}>
              <Link
                to={paths.app.topic.getHref(topic.id, s.tab)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition hover:bg-muted',
                  i === nextIndex && 'bg-primary/5 font-medium text-primary ring-1 ring-primary/20',
                )}
              >
                {s.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(s.done && 'text-muted-foreground line-through decoration-1')}>
                  {i + 1}. {s.label}
                </span>
                {s.skipped && (
                  <span className="ms-auto text-xs text-muted-foreground">
                    {t('topics.steps.skipped')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
