import type { AiJobStatus } from '@contenter/shared';
import { Loader2, Sparkles } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { useT } from '@/i18n';

export function JobStatusBadge({ status }: { status: AiJobStatus }) {
  const t = useT();
  return (
    <Badge tone={statusTone[status]}>
      {status === 'RUNNING' && <Loader2 className="animate-spin" />}
      {t(`enums.jobStatus.${status}`)}
    </Badge>
  );
}

/** Inline banner shown while an AI job is working on something the user is looking at. */
export function AiWorkingBanner({ title, hint }: { title?: string; hint?: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <div className="relative flex size-8 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="size-4" />
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
      </div>
      <div>
        <p className="font-medium">{title ?? t('jobs.running')}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
