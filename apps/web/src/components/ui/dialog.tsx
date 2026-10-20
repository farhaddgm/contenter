import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { InfoTip } from './info-tip';
import { cn } from '@/utils/cn';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Show the description in an "i" popup next to the title (pure explanations only). */
  descriptionAsTip?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const overlay = 'fixed inset-0 z-50 animate-fade-in bg-[#2a1a0a]/50 backdrop-blur-[3px]';

function Header({
  title,
  description,
  descriptionAsTip,
}: Pick<BaseProps, 'title' | 'description' | 'descriptionAsTip'>) {
  const tip = !!description && descriptionAsTip;
  return (
    <div className="space-y-1 pe-8">
      <D.Title className="flex items-center gap-2 text-lg font-bold leading-snug">
        {title}
        {tip ? <InfoTip>{description}</InfoTip> : null}
      </D.Title>
      {description ? (
        <D.Description className={tip ? 'sr-only' : 'text-sm text-muted-foreground'}>
          {description}
        </D.Description>
      ) : (
        <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>
      )}
    </div>
  );
}

function CloseButton() {
  const t = useT();
  return (
    <D.Close className="absolute end-4 top-4 flex size-9 items-center justify-center rounded-control text-muted-foreground transition hover:bg-muted hover:text-foreground">
      <X className="size-4" />
      <span className="sr-only">{t('common.close')}</span>
    </D.Close>
  );
}

/** Centered modal. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  descriptionAsTip,
  children,
  footer,
  className,
}: BaseProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          className={cn(
            'fixed start-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 animate-pop-in flex-col gap-4 rounded-2xl border bg-card p-6 shadow-pop ltr:-translate-x-1/2 rtl:translate-x-1/2',
            className,
          )}
        >
          <Header title={title} description={description} descriptionAsTip={descriptionAsTip} />
          <div className="-mx-1 overflow-y-auto px-1">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
          <CloseButton />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Side sheet (bulletproof-react "form drawer" pattern). Opens from the inline-end edge. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  descriptionAsTip,
  children,
  footer,
  className,
}: BaseProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          className={cn(
            'fixed inset-y-0 end-0 z-50 flex w-full max-w-xl animate-slide-in flex-col border-s bg-card shadow-pop ltr:[--slide-dir:1] rtl:[--slide-dir:-1]',
            className,
          )}
        >
          <div className="border-b px-6 py-5">
            <Header title={title} description={description} descriptionAsTip={descriptionAsTip} />
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">{footer}</div>
          )}
          <CloseButton />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
