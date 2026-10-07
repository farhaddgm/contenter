import type { Tag, TagColor } from '@contenter/shared';
import { cn } from '@/utils/cn';

/** Full class names so Tailwind sees every one of them. */
export const tagColorClass: Record<TagColor, string> = {
  slate: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  green: 'bg-green-500/15 text-green-700 dark:text-green-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  indigo: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  pink: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
};

/** Solid dot used by the color swatches. */
export const tagSwatchClass: Record<TagColor, string> = {
  slate: 'bg-slate-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
};

export function TagChip({
  tag,
  className,
}: {
  tag: Pick<Tag, 'name' | 'color'>;
  className?: string;
}) {
  return (
    <span
      dir="auto"
      className={cn(
        'inline-flex max-w-40 items-center truncate rounded-full px-2 py-0.5 text-xs font-medium',
        tagColorClass[tag.color] ?? tagColorClass.slate,
        className,
      )}
    >
      {tag.name}
    </span>
  );
}

export function TagChips({ tags, className }: { tags: Tag[] | undefined; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </span>
  );
}
