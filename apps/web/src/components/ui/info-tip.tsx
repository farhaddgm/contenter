import { useState, type ReactNode } from 'react';
import { Tooltip } from 'radix-ui';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * The "i" button of the design language: field explanations live in a popup that opens on hover,
 * keyboard focus or tap — never as always-visible helper text under the field.
 * Put it next to (not inside) the label so clicking it never activates the control.
 */
export function InfoTip({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Accessible name; defaults to "Help". */
  label?: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Provider delayDuration={80} skipDelayDuration={300}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label ?? t('common.help')}
            onClick={(e) => {
              // tap / Enter toggles (hover alone cannot open it on touch screens)
              e.preventDefault();
              setOpen((o) => !o);
            }}
            className={cn(
              'inline-flex size-[1.375rem] shrink-0 cursor-help select-none items-center justify-center rounded-full border border-input bg-card font-serif text-xs font-bold italic leading-none text-muted-foreground transition-colors hover:border-ring hover:bg-accent hover:text-accent-foreground data-[state=delayed-open]:border-ring data-[state=instant-open]:border-ring',
              className,
            )}
          >
            i
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="center"
            sideOffset={8}
            collisionPadding={12}
            className="z-[80] max-w-[min(22rem,calc(100vw-1.5rem))] animate-pop-in rounded-xl border bg-card px-3.5 py-3 text-start text-[13px] font-normal leading-7 text-card-foreground shadow-pop [overflow-wrap:anywhere]"
          >
            {children}
            <Tooltip.Arrow className="fill-card stroke-border" width={12} height={6} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/** Title text + its "i" button on one line (used by Field, card headers and settings rows). */
export function TitleWithTip({
  children,
  tip,
  className,
}: {
  children: ReactNode;
  tip?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {children}
      {tip ? <InfoTip>{tip}</InfoTip> : null}
    </span>
  );
}
