import { useState } from 'react';
import { ChevronDown, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { AuditIssue, AuditSeverity, BusinessSectionKey } from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';
import { useTrackJob } from '@/features/jobs/api/jobs';
import { AiWorkingBanner } from '@/features/jobs/components/job-status';
import { businessKeys, useCanEditBusiness } from '../api/businesses';
import {
  knowledgeKeys,
  useAudit,
  useDismissAuditIssue,
  useFixAuditIssue,
  useStartAudit,
} from '../api/profile-knowledge';

const SEVERITY_TONE: Record<AuditSeverity, BadgeTone> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

/**
 * AI quality review of the profile (BUSINESS_AUDIT): score, strengths and issues. "Fix with AI"
 * turns an issue into a one-off note applied as suggestions, so the admin still decides.
 */
export function AuditCard({
  businessId,
  disabled,
  onJump,
}: {
  businessId: string;
  /** A build is running. */
  disabled?: boolean;
  onJump: (key: BusinessSectionKey) => void;
}) {
  const t = useT();
  const editable = useCanEditBusiness(businessId);
  const { data: audit } = useAudit(businessId);
  const start = useStartAudit(businessId);
  const fix = useFixAuditIssue(businessId);
  const dismiss = useDismissAuditIssue(businessId);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showStrengths, setShowStrengths] = useState(false);

  const running = audit?.status === 'RUNNING';
  useTrackJob(running ? audit?.jobId : null, {
    invalidate: [knowledgeKeys.audit(businessId), businessKeys.one(businessId)],
  });

  const issues = (audit?.issues ?? []).map((issue, index) => ({ issue, index }));
  const visible = issues.filter(({ issue }) => issue.status !== 'DISMISSED');
  const dismissed = issues.filter(({ issue }) => issue.status === 'DISMISSED');

  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const startAudit = () =>
    start.mutate(undefined, {
      onSuccess: () => notify.info(t('businesses.audit.queued')),
      onError,
    });

  const issueRow = ({ issue, index }: { issue: AuditIssue; index: number }) => (
    <li
      key={index}
      className={cn(
        'space-y-2 rounded-lg border p-3',
        issue.status === 'DISMISSED' && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[issue.severity]}>
          {t(`enums.auditSeverity.${issue.severity}`)}
        </Badge>
        <Badge tone="outline">{t(`enums.auditIssueType.${issue.type}`)}</Badge>
        {issue.target === 'GENERAL' ? (
          <span className="text-xs text-muted-foreground">{t('businesses.audit.general')}</span>
        ) : (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onJump(issue.target as BusinessSectionKey)}
          >
            {t(`enums.businessSection.${issue.target as BusinessSectionKey}`)}
          </button>
        )}
      </div>
      <p className="text-sm font-medium leading-6" dir="auto">
        {issue.title}
      </p>
      {issue.detail && (
        <p className="text-xs leading-6 text-muted-foreground" dir="auto">
          {issue.detail}
        </p>
      )}
      {issue.fix && (
        <p className="text-xs leading-6" dir="auto">
          <span className="font-semibold">{t('businesses.audit.fixLabel')}</span> {issue.fix}
        </p>
      )}
      {issue.status === 'FIXING' && (
        <p className="flex items-center gap-1 text-xs text-primary">
          <Sparkles className="size-3.5" />
          {t('businesses.audit.fixing')}
        </p>
      )}
      {editable && audit && issue.status !== 'FIXING' && (
        <div className="flex flex-wrap gap-2">
          {issue.status === 'OPEN' && (
            <Button
              size="sm"
              variant="outline"
              icon={<Sparkles />}
              disabled={disabled}
              isLoading={fix.isPending && fix.variables?.index === index}
              onClick={() =>
                fix.mutate(
                  { auditId: audit.id, index, data: { apply: 'SUGGEST' } },
                  { onSuccess: () => notify.info(t('businesses.audit.fixQueued')), onError },
                )
              }
            >
              {t('businesses.audit.fix')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={issue.status === 'DISMISSED' ? <RotateCcw /> : <X />}
            isLoading={dismiss.isPending && dismiss.variables?.index === index}
            onClick={() => dismiss.mutate({ auditId: audit.id, index }, { onError })}
          >
            {issue.status === 'DISMISSED'
              ? t('businesses.audit.restore')
              : t('businesses.audit.dismiss')}
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <Card id="business-audit">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            {t('businesses.audit.title')}
          </span>
        }
        description={audit ? undefined : t('businesses.audit.hint')}
        actions={
          editable &&
          !running && (
            <Button
              size="sm"
              variant={audit ? 'outline' : 'default'}
              icon={<ShieldCheck />}
              disabled={disabled}
              isLoading={start.isPending}
              onClick={startAudit}
            >
              {audit ? t('businesses.audit.again') : t('businesses.audit.start')}
            </Button>
          )
        }
      />
      {audit && (
        <CardBody className="space-y-4">
          {running && (
            <AiWorkingBanner
              title={t('businesses.audit.running')}
              hint={t('businesses.audit.runningHint')}
            />
          )}
          {audit.status === 'FAILED' && (
            <p
              className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive"
              dir="auto"
            >
              {t('businesses.audit.failed')}
              {audit.error ? ` — ${audit.error}` : ''}
            </p>
          )}
          {audit.status === 'READY' && (
            <>
              <div className="flex flex-wrap items-start gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold tabular-nums">
                    {formatNumber(audit.score ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('businesses.audit.score')}</p>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm leading-6" dir="auto">
                    {audit.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('businesses.audit.at', { date: formatDate(audit.createdAt) })}
                  </p>
                </div>
              </div>
              {audit.strengths.length > 0 && (
                <div>
                  <button
                    type="button"
                    aria-expanded={showStrengths}
                    onClick={() => setShowStrengths((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn('size-3.5 transition', showStrengths && 'rotate-180')}
                    />
                    {t('businesses.audit.strengths')} ({formatNumber(audit.strengths.length)})
                  </button>
                  {showStrengths && (
                    <ul className="mt-2 list-disc space-y-1 ps-5 text-xs leading-6">
                      {audit.strengths.map((s, i) => (
                        <li key={i} dir="auto">
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  {t('businesses.audit.issues')} ({formatNumber(visible.length)})
                </p>
                {visible.length ? (
                  <ul className="space-y-2">{visible.map(issueRow)}</ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('businesses.audit.noIssues')}</p>
                )}
                {dismissed.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={showDismissed}
                      onClick={() => setShowDismissed((v) => !v)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn('size-3.5 transition', showDismissed && 'rotate-180')}
                      />
                      {t('businesses.audit.showDismissed', {
                        count: formatNumber(dismissed.length),
                      })}
                    </button>
                    {showDismissed && <ul className="space-y-2">{dismissed.map(issueRow)}</ul>}
                  </>
                )}
              </div>
            </>
          )}
        </CardBody>
      )}
    </Card>
  );
}
