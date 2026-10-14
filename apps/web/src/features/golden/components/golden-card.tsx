import { Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { useUser } from '@/lib/auth';
import { notify } from '@/stores/notifications';
import { useSetGolden } from '../api/golden';

/**
 * "Golden example" on the content page (docs/49): an admin marks approved text as the brand's
 * voice so later drafts of the business read it. Only admins see it; the server refuses content
 * that is not approved or published, and drops the mark when the text changes.
 */
export function GoldenCard({
  contentId,
  goldenAt,
  approved,
}: {
  contentId: string;
  goldenAt: string | null | undefined;
  /** Approved or published: the only content that can become an example. */
  approved: boolean;
}) {
  const t = useT();
  const me = useUser();
  const set = useSetGolden(contentId);
  if (me?.role !== 'ADMIN') return null;
  if (!goldenAt && !approved) return null;
  const golden = !!goldenAt;
  return (
    <Card className={golden ? 'border-primary/40' : undefined}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Award className="size-4 text-primary" />
            {t('golden.title')}
          </span>
        }
        description={golden ? t('golden.isGolden') : t('golden.canMark')}
      />
      <CardBody className="space-y-2">
        <Button
          size="sm"
          variant={golden ? 'outline' : 'default'}
          isLoading={set.isPending}
          onClick={() =>
            set.mutate(!golden, {
              onSuccess: () => notify.success(t(golden ? 'golden.removed' : 'golden.marked')),
              onError: (e) => notify.error(t('common.error'), e.message),
            })
          }
        >
          {golden ? t('golden.remove') : t('golden.mark')}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">{t('golden.hint')}</p>
      </CardBody>
    </Card>
  );
}
