import { useParams } from 'react-router';
import { VariantsCompare } from '@/features/contents/components/variants-compare';

export default function CompareRoute() {
  const { contentId = '' } = useParams();
  return <VariantsCompare key={contentId} contentId={contentId} />;
}
