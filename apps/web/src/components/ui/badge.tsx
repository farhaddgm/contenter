import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        primary: 'border-transparent bg-primary/10 text-primary',
        success: 'border-transparent bg-success/12 text-success',
        warning:
          'border-transparent bg-warning/15 text-[color-mix(in_oklch,var(--warning)_70%,black)] dark:text-warning',
        danger: 'border-transparent bg-destructive/10 text-destructive',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
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
};
