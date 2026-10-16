import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        primary: 'border-transparent bg-accent text-accent-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/18 text-[#7a4f00] dark:text-warning',
        danger: 'border-transparent bg-destructive/10 text-destructive',
        outline: 'border-border bg-card text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** `dot` adds the Bee-style status dot (colour = tone) before the label. */
export function Badge({
  className,
  tone,
  dot,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Maps domain statuses to badge tones in one place. */
export const statusTone: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  ARCHIVED: 'neutral',
  PENDING: 'neutral',
  FETCHED: 'success',
  SKIPPED: 'neutral',
  NONE: 'neutral',
  QUEUED: 'warning',
  RUNNING: 'primary',
  GENERATING: 'primary',
  DONE: 'success',
  SUCCEEDED: 'success',
  APPROVED: 'success',
  USED: 'primary',
  SHORTLISTED: 'primary',
  DRAFT: 'outline',
  IN_REVIEW: 'warning',
  PROPOSED: 'outline',
  REJECTED: 'danger',
  FAILED: 'danger',
  CANCELED: 'neutral',
  BUILDING: 'primary',
  RESEARCHING: 'primary',
  READY: 'success',
  ACCEPTED: 'success',
  DISMISSED: 'neutral',
};
