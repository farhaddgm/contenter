import { Crown } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/** Small "Owner" tag for every control or section only the project owner (OWNER_EMAIL) can use. */
export function OwnerBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      title={t('common.ownerHint')}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-brand px-2 text-[11px] font-bold leading-none text-brand-foreground [&_svg]:size-3',
        className,
      )}
    >
      <Crown aria-hidden />
      {t('common.owner')}
    </span>
  );
}
