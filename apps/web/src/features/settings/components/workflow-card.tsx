import { Workflow } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useUpdateWorkflowSettings, useWorkflowSettings } from '@/features/admin/api';

/** How many approvals a content needs (docs/21-review-workflow.md). */
export function WorkflowCard() {
  const t = useT();
  const { data } = useWorkflowSettings();
  const save = useUpdateWorkflowSettings();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Workflow className="size-4" />
            {t('review.settings.title')}
          </span>
        }
        description={t('review.settings.subtitle')}
      />
      <CardBody className="space-y-3">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <Switch
              checked={data.requireFinalApproval}
              disabled={save.isPending}
              onCheckedChange={(requireFinalApproval) =>
                save.mutate(
                  { requireFinalApproval },
                  {
                    onSuccess: () => notify.success(t('common.saved')),
                    onError: (e) => notify.error(t('common.error'), e.message),
                  },
                )
              }
              label={<span className="font-medium">{t('review.settings.requireFinal')}</span>}
            />
            <p className="text-xs leading-6 text-muted-foreground">
              {data.requireFinalApproval
                ? t('review.settings.twoStage')
                : t('review.settings.oneStage')}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
