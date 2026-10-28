import { orderOfferingTree } from '@contenter/shared';
import { useT } from '@/i18n';
import { useOfferings } from './offerings';
import { useSegments } from './segments';

/**
 * What a project or a content can focus on (docs/73): the business's active, confirmed offerings
 * (a variant under its line) and its active audiences. The one already chosen stays listed even if
 * it was switched off since, so the form can still show it.
 */
export function useFocusOptions(
  businessId: string | null | undefined,
  current: { offeringId?: string | null; segmentId?: string | null } = {},
) {
  const t = useT();
  const offerings = useOfferings(businessId);
  const segments = useSegments(businessId);
  const offeringOptions = orderOfferingTree(
    (offerings.data ?? []).filter((o) => (o.verified && o.isActive) || o.id === current.offeringId),
  ).map(({ row, depth }) => ({ value: row.id, label: `${depth ? `${'— '.repeat(depth)}` : ''}${row.name}` }));
  const segmentOptions = (segments.data ?? [])
    .filter((s) => s.isActive || s.id === current.segmentId)
    .map((s) => ({ value: s.id, label: `${s.name} (${t(`enums.segmentKind.${s.kind}`)})` }));
  return { offeringOptions, segmentOptions, segments: segments.data ?? [], isLoading: offerings.isLoading || segments.isLoading };
}
