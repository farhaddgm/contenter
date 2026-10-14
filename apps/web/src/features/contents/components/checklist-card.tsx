import { ClipboardCheck, Sparkles } from 'lucide-react';
import type { ContentChecklistItem } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatRelative } from '@/utils/format';
import { useToggleChecklistItem } from '../api/contents';

/**
 * The publishing checklist (docs/45): points the business wants confirmed before a content is
 * scheduled. People tick them; the automatic point shows the quality gate. An open required point
 * stops the content from being scheduled (the server answers 409).
 */
export function ChecklistCard({
  contentId,
  checklist,
  editable,
}: {
  contentId: string;
  checklist: { items: ContentChecklistItem[]; requiredOpen: number } | null | undefined;
  /** The caller may change the content and it is not frozen (published). */
  editable: boolean;
}) {
  const t = useT();
  const toggle = useToggleChecklistItem(contentId);
  if (!checklist) return null;

  const onToggle = (item: ContentChecklistItem) =>
    toggle.mutate(
      { itemId: item.id, checked: !item.checked },
      { onError: (e) => notify.error(t('common.error'), e.message) },
    );

  return (
    <Card className={checklist.requiredOpen ? 'border-warning/50' : undefined}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ClipboardCheck className="size-4" />
            {t('contents.checklist.title')}
          </span>
        }
        description={t('contents.checklist.hint')}
      />
      <CardBody className="space-y-3">
        <ul className="space-y-2">
          {checklist.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                id={`check-${item.id}`}
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={item.checked}
                disabled={!editable || !!item.auto || toggle.isPending}
                onChange={() => onToggle(item)}
              />
              <label htmlFor={`check-${item.id}`} className="min-w-0 flex-1 text-sm leading-6">
                <span dir="auto">{item.text}</span>
                {item.required && (
                  <Badge tone="warning" className="ms-2 align-middle">
                    {t('contents.checklist.required')}
                  </Badge>
                )}
                {item.auto && (
                  <span className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Sparkles className="size-3" />
                    {t('contents.checklist.auto')}
                  </span>
                )}
                {item.checkedAt && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('contents.checklist.by', {
                      name: item.checkedByName ?? '—',
                      when: formatRelative(item.checkedAt),
                    })}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {checklist.requiredOpen > 0 && (
          <p className="text-sm text-warning">
            {t('contents.checklist.open', { count: checklist.requiredOpen })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
