import { useEffect, useState, type ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { NavLink, Link, useLocation, useNavigate } from 'react-router';
import {
  Activity,
  Bot,
  Building2,
  CalendarDays,
  FileText,
  FolderKanban,
  Gauge,
  Globe,
  KeyRound,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  ChevronUp,
  Sparkles,
  UserCircle,
} from 'lucide-react';
import { paths } from '@/config/paths';
import { useT, type TranslationKey } from '@/i18n';
import { useAuthorization, useLogout } from '@/lib/auth';
import { useUi } from '@/stores/ui';
import { cn } from '@/utils/cn';
import { Dropdown } from '@/components/ui/misc';
import { NotificationBell } from '@/features/inbox/components/notification-bell';
import { SearchBox } from '@/features/search/components/search-box';
import { PageHeaderSlot } from '@/components/ui/page-header-slot';
import { SmartRoot } from '@/features/smart/components/smart-root';
import { SmartToggle } from '@/features/smart/components/smart-toggle';

interface NavItem {
  to: string;
  label: TranslationKey;
  icon: ReactNode;
  end?: boolean;
}

const contentNav: NavItem[] = [
  { to: paths.app.dashboard.getHref(), label: 'nav.dashboard', icon: <Gauge />, end: true },
  { to: paths.app.businesses.getHref(), label: 'nav.businesses', icon: <Building2 /> },
  { to: paths.app.topics.getHref(), label: 'nav.topics', icon: <FolderKanban /> },
  { to: paths.app.contents.getHref(), label: 'nav.contents', icon: <FileText /> },
  { to: paths.app.calendar.getHref(), label: 'nav.calendar', icon: <CalendarDays /> },
];

const adminNav: NavItem[] = [
  { to: paths.app.admin.jobs.getHref(), label: 'nav.jobs', icon: <Activity /> },
  { to: paths.app.admin.prompts.getHref(), label: 'nav.prompts', icon: <Bot /> },
  { to: paths.app.admin.principles.getHref(), label: 'nav.principles', icon: <ShieldCheck /> },
  { to: paths.app.admin.settings.getHref(), label: 'nav.settings', icon: <Settings /> },
  { to: paths.app.admin.audit.getHref(), label: 'nav.audit', icon: <ScrollText /> },
  { to: paths.app.admin.smart.getHref(), label: 'smart.name', icon: <Sparkles /> },
];

function SidebarBrand({ collapsed }: { collapsed?: boolean }) {
  const t = useT();
  return (
    <div className="mb-1 border-b border-white/15 pb-3.5 pt-1">
      <Link
        to={paths.app.dashboard.getHref()}
        title={collapsed ? t('app.name') : undefined}
        aria-label={t('app.name')}
        className="flex min-h-[3.25rem] items-center justify-center overflow-hidden rounded-xl outline-offset-4"
      >
        {collapsed ? (
          <img src="/logo.svg" alt="" className="h-9 w-14 object-contain" />
        ) : (
          <img
            src="/logo-full.svg"
            alt={t('app.name')}
            className="h-11 w-[13.5rem] object-contain"
          />
        )}
      </Link>
    </div>
  );
}

function NavSection({
  title,
  items,
  collapsed,
}: {
  title: string;
  items: NavItem[];
  collapsed?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-1" role="group" aria-label={title}>
      {collapsed ? (
        <div className="mx-3 my-3 h-px bg-white/12" />
      ) : (
        <p className="px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted">
          {title}
        </p>
      )}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={collapsed ? t(item.label) : undefined}
          aria-label={collapsed ? t(item.label) : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-[0.6875rem] px-3 py-2.5 text-sm font-semibold transition-colors [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:opacity-90',
              collapsed && 'justify-center px-0',
              isActive
                ? 'bg-sidebar-active text-white'
                : 'text-sidebar-foreground hover:bg-white/8 hover:text-white',
            )
          }
        >
          {item.icon}
          {!collapsed && <span className="truncate">{t(item.label)}</span>}
        </NavLink>
      ))}
    </div>
  );
}

/** The profile button: bottom of the sidebar, opens its menu upwards (as in Bee Researcher). */
function AccountMenu({ collapsed }: { collapsed?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuthorization();
  const logout = useLogout();
  if (!user) return null;
  return (
    <div className={cn('border-t border-white/15 pb-2.5 pt-4', collapsed ? 'px-0' : 'px-2')}>
      <Dropdown.Root>
        <Dropdown.Trigger
          title={collapsed ? user.name : undefined}
          aria-label={t('nav.account')}
          className={cn(
            'group flex w-full items-center gap-2 rounded-[0.625rem] border border-white/25 bg-white/8 text-start text-sidebar-foreground transition-colors hover:bg-white/15 data-[state=open]:bg-white/15',
            collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-2.5',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full bg-brand font-extrabold text-brand-foreground',
                collapsed ? 'size-9 text-sm' : 'size-[1.875rem] text-xs',
              )}
            >
              {user.name.slice(0, 1)}
            </span>
            {!collapsed && (
              <span className="grid min-w-0 gap-0.5 text-start">
                <strong className="truncate text-xs font-bold text-white">{user.name}</strong>
                <span className="text-[10px] text-sidebar-muted">
                  {t(`enums.role.${user.role}`)}
                </span>
              </span>
            )}
          </span>
          {!collapsed && (
            <ChevronUp className="size-4 shrink-0 opacity-80 transition-transform group-data-[state=open]:rotate-180" />
          )}
        </Dropdown.Trigger>
        <Dropdown.Content side="top" align="start" className="w-60">
          <Dropdown.Label>{user.email}</Dropdown.Label>
          <Dropdown.Item
            icon={<UserCircle />}
            onSelect={() => navigate(paths.app.account.getHref())}
          >
            {t('nav.account')}
          </Dropdown.Item>
          <Dropdown.Item icon={<KeyRound />} onSelect={() => navigate(paths.app.account.getHref())}>
            {t('auth.changePassword')}
          </Dropdown.Item>
          <Dropdown.Separator />
          <Dropdown.Item
            icon={<LogOut />}
            destructive
            onSelect={() =>
              logout.mutate(undefined, { onSettled: () => navigate(paths.auth.login.getHref()) })
            }
          >
            {t('nav.logout')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>
    </div>
  );
}

function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT();
  const { can } = useAuthorization();
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-1.5 bg-sidebar py-[1.125rem]',
        collapsed ? 'px-2.5' : 'px-3.5',
      )}
    >
      <SidebarBrand collapsed={collapsed} />
      <nav
        aria-label={t('app.name')}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden"
      >
        <NavSection title={t('nav.content')} items={contentNav} collapsed={collapsed} />
        {can('backoffice:access') && (
          <NavSection title={t('nav.backoffice')} items={adminNav} collapsed={collapsed} />
        )}
      </nav>
      <AccountMenu collapsed={collapsed} />
    </div>
  );
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed, lang, setLang } =
    useUi();
  const location = useLocation();
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);

  useEffect(() => setSidebarOpen(false), [location.pathname, setSidebarOpen]);

  return (
    <div className="flex min-h-screen w-full">
      <a
        href="#main"
        className="sr-only z-[70] rounded-control bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t('nav.skip')}
      </a>
      {/* desktop sidebar: in the flow, sticky, icons-only when collapsed */}
      <aside
        className={cn(
          'sticky top-0 z-30 hidden h-screen shrink-0 transition-[width] duration-200 lg:block',
          sidebarCollapsed ? 'w-[4.75rem]' : 'w-60',
        )}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>
      {/* mobile sidebar: a modal drawer (focus trap, Esc to close) */}
      <D.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-[64] animate-fade-in bg-[#0c1831]/45 backdrop-blur-[2px] lg:hidden" />
          <D.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 start-0 z-[65] w-72 max-w-[85vw] animate-slide-in shadow-pop outline-none ltr:[--slide-dir:-1] rtl:[--slide-dir:1] lg:hidden"
          >
            <D.Title className="sr-only">{t('nav.menu')}</D.Title>
            <Sidebar />
          </D.Content>
        </D.Portal>
      </D.Root>
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[4.5rem] items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          {/* one hamburger: opens the drawer on phones, collapses the sidebar on desktop */}
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-control bg-muted text-foreground transition hover:bg-accent hover:text-accent-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.openMenu')}
            aria-expanded={sidebarOpen}
          >
            <Menu className="size-5" />
          </button>
          <button
            type="button"
            className="hidden size-10 shrink-0 items-center justify-center rounded-control bg-muted text-foreground transition hover:bg-accent hover:text-accent-foreground lg:flex"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
            aria-expanded={!sidebarCollapsed}
          >
            <Menu className="size-5" />
          </button>
          {/* the page name (PageHeader portals into it) sits between the menu button and the search box */}
          <div ref={setTitleSlot} className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2" />
          <SearchBox />
          <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <NotificationBell />
            <SmartToggle />
            <button
              type="button"
              onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
              className="inline-flex h-10 items-center gap-2 rounded-full border bg-card px-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
            >
              <Globe className="size-4" />
              <span className="hidden sm:inline">{lang === 'fa' ? 'English' : 'فارسی'}</span>
            </button>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[96rem] min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          <PageHeaderSlot.Provider value={titleSlot}>{children}</PageHeaderSlot.Provider>
        </main>
        <SmartRoot />
      </div>
    </div>
  );
}
