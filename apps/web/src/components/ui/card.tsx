import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { InfoTip } from './info-tip';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border bg-card text-card-foreground shadow-card', className)}
      {...props}
    />
  );
}

/** Longest card description that is still printed under the title. */
export const CARD_DESCRIPTION_INLINE_MAX = 90;

export function CardHeader({
  title,
  description,
  actions,
  className,
  descriptionAsTip,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Always put the description in the "i" popup, however short it is (pure explanations only, never status). */
  descriptionAsTip?: boolean;
}) {
  // short subtitles stay visible; long explanations move into the "i" popup next to the title
  const tip =
    !!description &&
    (descriptionAsTip ||
      (typeof description === 'string' && description.length > CARD_DESCRIPTION_INLINE_MAX));
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h3 className="flex items-center gap-2 text-base font-bold leading-snug">
          {title}
          {tip && <InfoTip>{description}</InfoTip>}
        </h3>
        {description && !tip && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6', className)} {...props} />;
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'primary',
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: 'primary' | 'success' | 'warning' | 'muted';
}) {
  const tones = {
    primary: 'bg-accent text-accent-foreground',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/15 text-warning',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3.5">
        {icon && (
          <div
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5',
              tones[tone],
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</p>
        </div>
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
