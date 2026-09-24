import { useParams } from 'react-router';
import { ContentView } from '@/features/contents/components/content-view';

export default function ContentRoute() {
  const { contentId = '' } = useParams();
  return <ContentView key={contentId} contentId={contentId} />;
}
