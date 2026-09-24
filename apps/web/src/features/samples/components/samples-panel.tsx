import { useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Music,
  Plus,
  RefreshCw,
  ScanSearch,
  Trash2,
  Video,
} from 'lucide-react';
import type { MediaType, SampleContent } from '@contenter/shared';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageSpinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useAuthorization } from '@/lib/auth';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/format';
import { useAnalyzeSample, useDeleteSample, useRefetchSample, useSamples } from '../api/samples';
import { AddSampleDrawer } from './add-sample';
import { SampleAnalysisView } from './sample-analysis';

const mediaIcon: Record<MediaType, React.ReactNode> = {
  ARTICLE: <FileText />,
  VIDEO: <Video />,
  IMAGE: <ImageIcon />,
  POST: <FileText />,
  AUDIO: <Music />,
  UNKNOWN: <Link2 />,
};

function SampleCard({ sample, topicId }: { sample: SampleContent; topicId: string }) {
  const t = useT();
  const { can } = useAuthorization();
  const [open, setOpen] = useState(false);
  const analyze = useAnalyzeSample(topicId);
  const refetch = useRefetchSample(topicId);
  const remove = useDeleteSample(topicId);
  const f = sample.fetched;
  const thumb = f?.images?.[0];
  const title = f?.title || sample.url;

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-md bg-muted">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground [&_svg]:size-7">
              {mediaIcon[sample.mediaType]}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <a
              href={sample.url}
              target="_blank"
              rel="noreferrer noopener"
              className="line-clamp-2 font-medium hover:text-primary"
              dir="auto"
            >
              {title} <ExternalLink className="inline size-3.5 text-muted-foreground" />
            </a>
          </div>
          {f?.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
              {f.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="outline">{t(`enums.platform.${sample.platform}`)}</Badge>
            <Badge tone="outline">{t(`enums.mediaType.${sample.mediaType}`)}</Badge>
            <Badge tone={statusTone[sample.fetchStatus]}>
              {t(`enums.fetchStatus.${sample.fetchStatus}`)}
            </Badge>
            <Badge tone={statusTone[sample.analysisStatus]}>
              {sample.analysisStatus === 'QUEUED' && <RefreshCw className="animate-spin" />}
              {t(`enums.analysisStatus.${sample.analysisStatus}`)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatRelative(sample.createdAt)}
            </span>
          </div>
          {sample.fetchStatus === 'FAILED' && sample.fetchError && (
            <p className="text-xs text-destructive" dir="auto">
              {sample.fetchError}
            </p>
          )}
          {sample.fetchStatus === 'FETCHED' && !f?.text && !sample.manualText && (
            <p className="text-xs text-warning">{t('samples.noText')}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {can('content:write') && (
            <>
              <Button
                size="sm"
                variant={sample.analysisStatus === 'DONE' ? 'ghost' : 'secondary'}
                icon={<ScanSearch />}
                disabled={sample.analysisStatus === 'QUEUED'}
                isLoading={analyze.isPending}
                onClick={() =>
                  analyze.mutate(sample.id, {
                    onSuccess: () => notify.info(t('samples.analysisQueued')),
                    onError: (e) => notify.error(t('common.error'), e.message),
                  })
                }
              >
                {sample.analysisStatus === 'DONE' ? t('samples.reanalyze') : t('samples.analyze')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw />}
                isLoading={refetch.isPending}
                onClick={() => refetch.mutate(sample.id)}
              >
                {t('samples.refetch')}
              </Button>
              <ConfirmationDialog
                trigger={
                  <Button size="sm" variant="ghost" icon={<Trash2 />}>
                    {t('common.delete')}
                  </Button>
                }
                onConfirm={() => remove.mutateAsync(sample.id)}
                isLoading={remove.isPending}
              />
            </>
          )}
        </div>
        {(sample.analysis || sample.manualText || f?.text) && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {t('common.details')}
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-4 border-t p-4">
          {sample.analysis && <SampleAnalysisView analysis={sample.analysis} />}
          {(sample.manualText || f?.text) && (
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">{t('samples.fetched')}</summary>
              {sample.adminNote && (
                <p className="mt-2 text-muted-foreground">📝 {sample.adminNote}</p>
              )}
              <p
                className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap leading-7 text-muted-foreground"
                dir="auto"
              >
                {sample.manualText || f?.text}
              </p>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export function SamplesPanel({ topicId }: { topicId: string }) {
  const t = useT();
  const drawer = useDisclosure();
  const { can } = useAuthorization();
  const { data, isLoading } = useSamples(topicId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('samples.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('samples.subtitle')}</p>
        </div>
        {can('content:write') && (
          <Button icon={<Plus />} onClick={drawer.open}>
            {t('samples.add')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <PageSpinner />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Link2 />}
            title={t('samples.empty')}
            description={t('samples.emptyHint')}
            action={
              can('content:write') && (
                <Button icon={<Plus />} onClick={drawer.open}>
                  {t('samples.add')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.map((s) => (
            <SampleCard key={s.id} sample={s} topicId={topicId} />
          ))}
        </div>
      )}
      <AddSampleDrawer topicId={topicId} open={drawer.isOpen} onOpenChange={drawer.setIsOpen} />
    </div>
  );
}
