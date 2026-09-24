import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NavLink } from 'react-router';
import { DropdownMenu as DM } from 'radix-ui';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { Button } from './button';

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
  return (
    <div className="mb-6 space-y-2">
      {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-content', className)} dir="auto">
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
      className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-start text-xs leading-5"
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
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
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
    <div className="inline-flex rounded-lg border bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === o.value
              ? 'bg-card text-foreground shadow-xs'
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
  Root: DM.Root,
  Trigger: DM.Trigger,
  Content: ({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) => (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-44 rounded-lg border bg-card p-1 text-sm shadow-lg"
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
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-muted [&_svg]:size-4',
        destructive && 'text-destructive',
      )}
    >
      {icon}
      {children}
    </DM.Item>
  ),
  Label: ({ children }: { children: ReactNode }) => (
    <DM.Label className="px-2.5 py-1.5 text-xs text-muted-foreground">{children}</DM.Label>
  ),
  Separator: () => <DM.Separator className="my-1 h-px bg-border" />,
};
