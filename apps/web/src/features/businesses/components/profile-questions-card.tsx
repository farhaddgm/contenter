import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { PROFILE_ANSWER_MAX, type ProfileQuestion, type ProfileQuestionAction } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form-controls';
import { useT, type TFn } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatNumber } from '@/utils/format';
import { useCanEditBusiness } from '../api/businesses';
import {
  useAnswerQuestion,
  useProfileQuestions,
  useResetSkippedQuestions,
  useSkipQuestion,
} from '../api/questions';

/** Questions shown before "show all". */
const VISIBLE = 3;

/** `SECTION_THIN:OVERVIEW` → the key of its text; the section's name fills `{{section}}`. */
export function questionText(t: TFn, q: ProfileQuestion): string {
  const kind = q.code.split(':')[0]!.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  return t(`businesses.questions.items.${kind}` as Parameters<TFn>[0], {
    section: q.sectionKey ? t(`enums.businessSection.${q.sectionKey}`) : '',
    count: formatNumber(q.count),
  });
}

/**
 * The gaps of the profile as short questions (docs/72), found by code. A section question is
 * answered right here and the answer is appended to that section; the others open the place where
 * the data is entered.
 */
export function ProfileQuestionsCard({
  businessId,
  onGoto,
}: {
  businessId: string;
  onGoto: (action: Exclude<ProfileQuestionAction, 'ANSWER'>, q: ProfileQuestion) => void;
}) {
  const t = useT();
  const canEdit = useCanEditBusiness(businessId);
  const { data } = useProfileQuestions(businessId);
  const skip = useSkipQuestion(businessId);
  const reset = useResetSkippedQuestions(businessId);
  const [all, setAll] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  if (!data || (!data.questions.length && !data.skipped)) return null;
  const shown = all ? data.questions : data.questions.slice(0, VISIBLE);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <HelpCircle className="size-4" />
            {t('businesses.questions.title')}
          </span>
        }
        description={t('businesses.questions.hint', { count: formatNumber(data.total) })}
        descriptionAsTip
      />
      <CardBody className="space-y-3">
        {!data.questions.length && (
          <p className="text-sm text-muted-foreground">{t('businesses.questions.done')}</p>
        )}
        <ul className="space-y-2">
          {shown.map((q) => (
            <li key={q.code} className="rounded-lg border px-4 py-3">
              <p className="text-sm font-medium" dir="auto">
                {questionText(t, q)}
              </p>
              {canEdit && answering !== q.code && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.action === 'ANSWER' ? (
                    <Button size="sm" onClick={() => setAnswering(q.code)}>
                      {t('businesses.questions.answer')}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => onGoto(q.action as Exclude<ProfileQuestionAction, 'ANSWER'>, q)}>
                      {t(`businesses.questions.goto.${q.action}` as Parameters<TFn>[0])}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    isLoading={skip.isPending && skip.variables === q.code}
                    onClick={() => skip.mutate(q.code, { onError: (e) => notify.error(t('common.error'), e.message) })}
                  >
                    {t('businesses.questions.skip')}
                  </Button>
                </div>
              )}
              {answering === q.code && (
                <AnswerForm businessId={businessId} code={q.code} onClose={() => setAnswering(null)} />
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {data.questions.length > VISIBLE && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ChevronDown className={all ? 'rotate-180' : ''} />}
              onClick={() => setAll((v) => !v)}
            >
              {all
                ? t('businesses.questions.fewer')
                : t('businesses.questions.more', { count: formatNumber(data.questions.length - VISIBLE) })}
            </Button>
          )}
          {canEdit && data.skipped > 0 && (
            <Button size="sm" variant="ghost" isLoading={reset.isPending} onClick={() => reset.mutate()}>
              {t('businesses.questions.showSkipped', { count: formatNumber(data.skipped) })}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** Mounted only while open, so its text starts empty each time (no reset-in-effect). */
function AnswerForm({ businessId, code, onClose }: { businessId: string; code: string; onClose: () => void }) {
  const t = useT();
  const answer = useAnswerQuestion(businessId);
  const [text, setText] = useState('');

  return (
    <div className="mt-2 space-y-2">
      <Textarea
        dir="auto"
        rows={4}
        maxLength={PROFILE_ANSWER_MAX}
        value={text}
        aria-label={t('businesses.questions.answerLabel')}
        placeholder={t('businesses.questions.answerHint')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!text.trim()}
          isLoading={answer.isPending}
          onClick={() =>
            answer.mutate(
              { code, answer: text },
              {
                onSuccess: () => {
                  notify.success(t('businesses.questions.saved'));
                  onClose();
                },
                onError: (e) => notify.error(t('common.error'), e.message),
              },
            )
          }
        >
          {t('common.save')}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
