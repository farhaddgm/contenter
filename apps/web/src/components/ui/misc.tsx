import { useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Copy } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NavLink } from 'react-router';
import { DropdownMenu as DM } from 'radix-ui';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { Button } from './button';
import { InfoTip } from './info-tip';
import { PageHeaderSlot } from './page-header-slot';

/**
 * Page title block. Inside the dashboard layout the page name goes to the top bar (between the menu
 * button and the search box) with the description in an "i" popup; only the breadcrumb and the
 * actions stay in the page. Without the layout (tests, standalone) everything renders inline.
 * Actions are authored primary-first; `flex-row-reverse` makes the primary action the last one in
 * reading order (Bee Researcher rule), in both RTL and LTR.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  const slot = useContext(PageHeaderSlot);
  const heading = (
    <h1
      className={cn(
        'text-balance font-extrabold leading-snug tracking-tight',
        slot ? 'truncate text-lg sm:text-xl' : 'text-2xl sm:text-[1.65rem]',
      )}
    >
      {title}
    </h1>
  );
  const actionRow = actions && (
    <div className="flex max-w-full flex-row-reverse flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start">
      {actions}
    </div>
  );
  if (slot) {
    return (
      <>
        {createPortal(
          <>
            {heading}
            {description && <InfoTip>{description}</InfoTip>}
          </>,
          slot,
        )}
        {(breadcrumb || actionRow) && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {breadcrumb ? (
              <div className="min-w-0 text-sm text-muted-foreground">{breadcrumb}</div>
            ) : (
              <span />
            )}
            {actionRow}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="mb-7 space-y-3">
      {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-80 space-y-1.5">
          {heading}
          {description && (
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">{description}</p>
          )}
        </div>
        {actionRow}
      </div>
    </div>
  );
}

export function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-content', className)}>
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

export function CopyButton({
  text,
  label,
  size = 'sm',
}: {
  text: string;
  label?: string;
  size?: 'sm' | 'icon-sm';
}) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size={size}
      icon={done ? <Check /> : <Copy />}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {size === 'sm' && (done ? t('common.copied') : (label ?? t('common.copy')))}
    </Button>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return (
    <pre
      dir="ltr"
      className="max-h-96 overflow-auto rounded-control bg-muted p-3 text-start text-xs leading-5"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Route-driven tabs (URL is the source of truth). */
export function TabLinks({
  tabs,
}: {
  tabs: { to: string; label: ReactNode; end?: boolean; badge?: ReactNode }[];
}) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b [scrollbar-width:none]">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap rounded-t-control border-b-[3px] px-3.5 py-3 text-sm font-semibold transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )
          }
        >
          {tab.label}
          {tab.badge}
        </NavLink>
      ))}
    </nav>
  );
}

/** Segmented filter control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div role="group" className="inline-flex rounded-control border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-8 rounded-lg px-3 py-1 text-[13px] font-semibold transition-colors',
            value === o.value
              ? 'bg-card text-primary shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Dropdown = {
  // non-modal: a modal menu locks body scroll, which hides the page scrollbar and shifts the layout
  Root: (props: ComponentProps<typeof DM.Root>) => <DM.Root modal={false} {...props} />,
  Trigger: DM.Trigger,
  Content: ({
    children,
    align = 'end',
    side = 'bottom',
    className,
  }: {
    children: ReactNode;
    align?: 'start' | 'end';
    side?: 'top' | 'bottom';
    className?: string;
  }) => (
    <DM.Portal>
      <DM.Content
        align={align}
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'z-[70] min-w-48 animate-pop-in rounded-xl border bg-card p-1.5 text-sm text-card-foreground shadow-pop',
          className,
        )}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  ),
  Item: ({
    children,
    onSelect,
    icon,
    destructive,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    icon?: ReactNode;
    destructive?: boolean;
  }) => (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 font-medium outline-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive [&_svg]:text-destructive',
      )}
    >
      {icon}
      {children}
    </DM.Item>
  ),
  Label: ({ children }: { children: ReactNode }) => (
    <DM.Label className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </DM.Label>
  ),
  Separator: () => <DM.Separator className="my-1 h-px bg-border" />,
  Sub: DM.Sub,
  SubTrigger: ({ children, icon }: { children: ReactNode; icon?: ReactNode }) => (
    <DM.SubTrigger className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 font-medium outline-none data-[highlighted]:bg-muted data-[state=open]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <span className="flex-1 text-start">{children}</span>
      <ChevronRight className="size-4 shrink-0 rtl:rotate-180" />
    </DM.SubTrigger>
  ),
  SubContent: ({ children }: { children: ReactNode }) => (
    <DM.Portal>
      <DM.SubContent
        sideOffset={8}
        alignOffset={-6}
        collisionPadding={12}
        className="z-[70] min-w-44 animate-pop-in rounded-xl border bg-card p-1.5 text-sm text-card-foreground shadow-pop"
      >
        {children}
      </DM.SubContent>
    </DM.Portal>
  ),
};
