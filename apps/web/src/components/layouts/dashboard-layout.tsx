import { useEffect, type ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { NavLink, Link, useLocation, useNavigate } from 'react-router';
import {
  Activity,
  Bug,
  MousePointerClick,
  NotebookPen,
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
  PanelRightClose,
  PanelRightOpen,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Check,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { paths } from '@/config/paths';
import { useT, type TranslationKey } from '@/i18n';
import { useAuthorization, useLogout } from '@/lib/auth';
import { useUi } from '@/stores/ui';
import { cn } from '@/utils/cn';
import { Dropdown } from '@/components/ui/misc';
import { NotificationBell } from '@/features/inbox/components/notification-bell';
import { SearchBox } from '@/features/search/components/search-box';
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

const smartNav: NavItem[] = [
  { to: paths.app.admin.smartErrors.getHref(), label: 'smart.nav.errors', icon: <Bug /> },
  { to: paths.app.admin.smartIssues.getHref(), label: 'smart.nav.issues', icon: <NotebookPen /> },
  {
    to: paths.app.admin.smartInteractions.getHref(),
    label: 'smart.nav.interactions',
    icon: <MousePointerClick />,
  },
];

const adminNav: NavItem[] = [
  { to: paths.app.admin.jobs.getHref(), label: 'nav.jobs', icon: <Activity /> },
  { to: paths.app.admin.prompts.getHref(), label: 'nav.prompts', icon: <Bot /> },
  { to: paths.app.admin.principles.getHref(), label: 'nav.principles', icon: <ShieldCheck /> },
  { to: paths.app.admin.users.getHref(), label: 'nav.users', icon: <Users /> },
  { to: paths.app.admin.settings.getHref(), label: 'nav.settings', icon: <Settings /> },
  { to: paths.app.admin.audit.getHref(), label: 'nav.audit', icon: <ScrollText /> },
];

function Logo({ collapsed }: { collapsed?: boolean }) {
  const t = useT();
  return (
    <Link
      to={paths.app.dashboard.getHref()}
      className="flex items-center gap-3 rounded-xl px-2 py-1 outline-offset-4"
      title={collapsed ? t('app.name') : undefined}
    >
      <img src="/logo.svg" alt="" className="size-10 shrink-0 rounded-xl shadow-md" />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="text-lg font-extrabold text-white" dir="ltr">
            {t('app.name')}
          </p>
          <p className="truncate text-[11px] text-sidebar-muted">{t('app.tagline')}</p>
        </div>
      )}
    </Link>
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
        <div className="mx-3 mb-2 h-px bg-white/10" />
      ) : (
        <p className="px-3 pb-1.5 text-[11px] font-bold tracking-wide text-sidebar-muted">
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
              'group relative flex items-center gap-3 rounded-[0.6875rem] px-3 py-2.5 text-sm font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0',
              collapsed && 'justify-center px-0',
              isActive
                ? 'bg-sidebar-active font-bold text-white before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-brand'
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

function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT();
  const { can } = useAuthorization();
  const { setSidebarCollapsed } = useUi();
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-6 bg-sidebar py-5',
        collapsed ? 'items-stretch px-2' : 'px-3',
      )}
    >
      <Logo collapsed={collapsed} />
      <nav
        aria-label={t('app.name')}
        className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden"
      >
        <NavSection title={t('nav.content')} items={contentNav} collapsed={collapsed} />
        {can('backoffice:access') && (
          <NavSection title={t('nav.backoffice')} items={adminNav} collapsed={collapsed} />
        )}
        {can('backoffice:access') && (
          <NavSection title={t('smart.name')} items={smartNav} collapsed={collapsed} />
        )}
      </nav>
      <button
        type="button"
        onClick={() => setSidebarCollapsed(!collapsed)}
        title={collapsed ? t('nav.expand') : t('nav.collapse')}
        aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
        className="hidden items-center gap-3 rounded-[0.6875rem] border-t border-white/10 px-3 py-2.5 text-xs font-medium text-sidebar-muted transition-colors hover:bg-white/8 hover:text-white lg:flex [&_svg]:size-[18px]"
      >
        {collapsed ? (
          <PanelRightOpen className="mx-auto ltr:scale-x-[-1]" />
        ) : (
          <PanelRightClose className="ltr:scale-x-[-1]" />
        )}
        {!collapsed && t('nav.collapse')}
      </button>
    </div>
  );
}

function UserMenu() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuthorization();
  const logout = useLogout();
  const { theme, setTheme, lang, setLang } = useUi();
  if (!user) return null;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex items-center gap-2.5 rounded-full border bg-card p-1 pe-3.5 text-sm shadow-xs transition hover:border-ring/60">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand text-sm font-extrabold text-brand-foreground">
          {user.name.slice(0, 1)}
        </span>
        <span className="hidden text-start sm:block">
          <span className="block max-w-32 truncate text-[13px] font-bold leading-tight">
            {user.name}
          </span>
          <span className="block text-[11px] leading-tight text-muted-foreground">
            {t(`enums.role.${user.role}`)}
          </span>
        </span>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Label>{user.email}</Dropdown.Label>
        <Dropdown.Item icon={<UserCircle />} onSelect={() => navigate(paths.app.account.getHref())}>
          {t('nav.account')}
        </Dropdown.Item>
        <Dropdown.Separator />
        <Dropdown.Label>{t('nav.theme')}</Dropdown.Label>
        {(
          [
            ['light', <Sun key="l" />],
            ['dark', <Moon key="d" />],
            ['system', <Monitor key="s" />],
          ] as const
        ).map(([value, icon]) => (
          <Dropdown.Item key={value} icon={icon} onSelect={() => setTheme(value)}>
            <span className={cn('flex-1', theme === value && 'font-bold text-primary')}>
              {t(`nav.${value}`)}
            </span>
            {theme === value && <Check className="text-primary" />}
          </Dropdown.Item>
        ))}
        <Dropdown.Separator />
        <Dropdown.Item icon={<Globe />} onSelect={() => setLang(lang === 'fa' ? 'en' : 'fa')}>
          {lang === 'fa' ? 'English' : 'فارسی'}
        </Dropdown.Item>
        <Dropdown.Separator />
        <Dropdown.Item icon={<KeyRound />} onSelect={() => navigate(paths.app.account.getHref())}>
          {t('auth.changePassword')}
        </Dropdown.Item>
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
  );
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed } = useUi();
  const location = useLocation();

  useEffect(() => setSidebarOpen(false), [location.pathname, setSidebarOpen]);

  return (
    <div className="min-h-screen w-full">
      <a
        href="#main"
        className="sr-only z-[70] rounded-control bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t('nav.skip')}
      </a>
      {/* desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-30 hidden transition-[width] duration-200 lg:block',
          sidebarCollapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>
      {/* mobile sidebar: a modal drawer (focus trap, Esc to close) */}
      <D.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-[64] animate-fade-in bg-[#2a1a0a]/55 backdrop-blur-[2px] lg:hidden" />
          <D.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 start-0 z-[65] w-72 max-w-[85vw] animate-slide-in shadow-pop outline-none ltr:[--slide-dir:-1] rtl:[--slide-dir:1] lg:hidden"
          >
            <D.Title className="sr-only">{t('nav.menu')}</D.Title>
            <Sidebar />
            <D.Close
              aria-label={t('common.close')}
              className="absolute end-3 top-5 rounded-control p-1.5 text-sidebar-foreground hover:bg-white/10"
            >
              <X className="size-5" />
            </D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>
      <div
        className={cn(
          'flex min-h-screen min-w-0 flex-col transition-[padding] duration-200',
          sidebarCollapsed ? 'lg:ps-[4.5rem]' : 'lg:ps-64',
        )}
      >
        <header className="sticky top-0 z-20 flex h-[4.5rem] items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-control border bg-card text-foreground transition hover:bg-muted lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <Menu className="size-5" />
          </button>
          <SearchBox />
          <div className="flex shrink-0 items-center gap-1.5 sm:ms-auto sm:gap-2.5">
            <NotificationBell />
            <SmartToggle />
            <UserMenu />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[96rem] min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
        <SmartRoot />
      </div>
    </div>
  );
}
