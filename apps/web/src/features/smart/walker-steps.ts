import { WalkerStepKey, type WalkerProgress } from '@contenter/shared';
import { paths } from '@/config/paths';

export const WALKER_STEPS = WalkerStepKey;

/** The page where the admin performs a Walker step. */
export function stepHref(
  step: WalkerStepKey,
  topicId: string | null,
  refs?: WalkerProgress['refs'],
): string {
  if (!topicId || step === 'select_topic') return paths.app.topics.getHref();
  switch (step) {
    case 'describe_topic':
      return paths.app.topic.getHref(topicId);
    case 'principles':
      return paths.app.topic.getHref(topicId, 'principles');
    case 'add_samples':
    case 'analyze_samples':
      return paths.app.topic.getHref(topicId, 'samples');
    case 'build_profile':
    case 'approve_profile':
      return paths.app.topic.getHref(topicId, 'profile');
    case 'ideate':
    case 'generate_content':
      return paths.app.topic.getHref(topicId, 'ideas');
    case 'review_content':
    case 'approve_content': {
      const id = refs?.reviewContentId ?? refs?.latestContentId;
      return id ? paths.app.content.getHref(id) : paths.app.topic.getHref(topicId, 'contents');
    }
  }
}

/** Extracts a topic id from the current URL (/app/topics/:id/...). */
export function topicIdFromPath(pathname: string): string | null {
  return /^\/app\/topics\/([^/]+)/.exec(pathname)?.[1] ?? null;
}
