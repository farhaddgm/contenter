import { MessageSquareShare, Sparkles } from 'lucide-react';
import { BusinessSectionKey, type TabFeedbackTab } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { useTabFeedback } from '../api/businesses';

/** Profile sections a tab's "AI suggestion" starts with (the dialog lets the admin change them). */
export const TAB_SUGGEST_KEYS: Record<TabFeedbackTab, BusinessSectionKey[]> = {
  knowledge: ['GUIDELINES', 'BRAND_BOOK', 'FAQ'],
  coverage: ['CONTENT_PILLARS', 'GOALS', 'CALENDAR'],
  references: ['OVERVIEW', 'KEY_MESSAGES', 'CHANNELS'],
  assets: ['BRAND_BOOK', 'BRAND_VOICE', 'KEY_MESSAGES'],
  styles: ['BRAND_VOICE', 'KEY_MESSAGES'],
  competitors: ['COMPETITORS', 'VALUE_PROPOSITION'],
};

/**
 * The two AI actions every supporting tab shares: "AI suggestion" (the dialog asks whether AI may
 * read only the profile or also the web and chosen references) and "Feedback to profile".
 */
export function TabAiBar({
  businessId,
  tab,
  disabled,
  onSuggest,
}: {
  businessId: string;
  tab: TabFeedbackTab;
  disabled?: boolean;
  onSuggest: (keys: BusinessSectionKey[]) => void;
}) {
  const t = useT();
  const feedback = useTabFeedback(businessId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        icon={<Sparkles />}
        disabled={disabled}
        onClick={() => onSuggest(TAB_SUGGEST_KEYS[tab])}
      >
        {t('businesses.suggestAi')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        icon={<MessageSquareShare />}
        disabled={disabled}
        isLoading={feedback.isPending}
        onClick={() =>
          feedback.mutate(tab, {
            onSuccess: () => notify.success(t('businesses.tabFeedback.sent')),
            onError: (e) => notify.error(t('common.error'), e.message),
          })
        }
      >
        {t('businesses.tabFeedback.button')}
      </Button>
      <InfoTip>{t('businesses.tabFeedback.hint')}</InfoTip>
    </div>
  );
}
