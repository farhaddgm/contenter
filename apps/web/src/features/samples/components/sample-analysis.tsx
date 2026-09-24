import type { SampleAnalysis } from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { useT, type TranslationKey } from '@/i18n';

const FIELDS = [
  'tone',
  'voice',
  'audience',
  'structure',
  'hook',
  'length',
  'formatting',
  'cta',
  'visualStyle',
  'languageNotes',
] as const;

export function SampleAnalysisView({ analysis }: { analysis: SampleAnalysis }) {
  const t = useT();
  const r = analysis.result;
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-sm font-semibold text-primary">{t('samples.analysis')}</h4>
        <p className="text-sm leading-7">{r.summary}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f}>
            <dt className="text-xs font-medium text-muted-foreground">
              {t(`samples.analysisFields.${f}` as TranslationKey)}
            </dt>
            <dd className="leading-7">{r[f]}</dd>
          </div>
        ))}
      </dl>
      {r.strengths.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t('samples.analysisFields.strengths')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {r.strengths.map((s, i) => (
              <Badge key={i} tone="success">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t('samples.analysisFields.traits')}
        </p>
        <ul className="space-y-2">
          {r.traits.map((tr, i) => (
            <li key={i} className="rounded-md border p-3 text-sm">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone="primary">{t(`enums.traitCategory.${tr.category}`)}</Badge>
                <span className="font-medium">{tr.name}</span>
              </div>
              <p className="leading-7">{tr.description}</p>
              {tr.evidence && (
                <p className="mt-1 text-xs leading-6 text-muted-foreground">« {tr.evidence} »</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
