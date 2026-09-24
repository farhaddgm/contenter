import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const overlay =
  'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0';

function Header({ title, description }: Pick<BaseProps, 'title' | 'description'>) {
  return (
    <div className="space-y-1 pe-8">
      <D.Title className="text-lg font-semibold">{title}</D.Title>
      {description ? (
        <D.Description className="text-sm text-muted-foreground">{description}</D.Description>
      ) : (
        <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>
      )}
    </div>
  );
}

function CloseButton() {
  return (
    <D.Close className="absolute end-4 top-4 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <X className="size-4" />
      <span className="sr-only">close</span>
    </D.Close>
  );
}

/** Centered modal. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
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
            'fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 flex-col gap-4 rounded-xl border bg-card p-6 shadow-2xl ltr:-translate-x-1/2 rtl:translate-x-1/2',
            className,
          )}
        >
          <Header title={title} description={description} />
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
            'fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col border-s bg-card shadow-2xl',
            className,
          )}
        >
          <div className="border-b px-6 py-5">
            <Header title={title} description={description} />
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
