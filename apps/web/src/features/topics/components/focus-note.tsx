import { useT } from '@/i18n';
import { useFocusOptions } from '@/features/businesses/api/focus';
import { useTopic } from '../api/topics';

/** The project's focus as a short note: who the piece is for and what convinces them (docs/73). */
export function useFocusNames(topicId: string) {
  const { data: topic } = useTopic(topicId);
  const { segments } = useFocusOptions(topic?.businessId, topic ?? {});
  const names = [topic?.offering?.name, topic?.segment?.name].filter(Boolean).join(' · ');
  const angle = segments.find((s) => s.id === topic?.segmentId)?.messageAngle.trim() ?? '';
  return { names, angle };
}

export function FocusNote({ topicId }: { topicId: string }) {
  const t = useT();
  const { names, angle } = useFocusNames(topicId);
  if (!names) return null;
  return (
    <div className="space-y-1 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm" data-bidi="">
      <p className="font-medium">{t('contents.focusFor', { names })}</p>
      {angle && <p className="text-xs text-muted-foreground">{t('contents.focusAngle', { angle })}</p>}
    </div>
  );
}
