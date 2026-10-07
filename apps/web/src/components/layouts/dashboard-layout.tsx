import { useEffect, type ReactNode } from 'react';
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
  Monitor,
  Moon,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
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

function Logo() {
  const t = useT();
  return (
    <Link to={paths.app.dashboard.getHref()} className="flex items-center gap-2.5 px-2">
      <img src="/logo.svg" alt="" className="size-8" />
      <div className="leading-tight">
        <p className="font-bold text-white">{t('app.name')}</p>
        <p className="text-[11px] text-sidebar-muted">{t('app.tagline')}</p>
      </div>
    </Link>
  );
}

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
        {title}
      </p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-[18px]',
              isActive
                ? 'bg-sidebar-active text-white shadow-inner'
                : 'text-sidebar-foreground hover:bg-white/5 hover:text-white',
            )
          }
        >
          {item.icon}
          {t(item.label)}
        </NavLink>
      ))}
    </div>
  );
}

function Sidebar() {
  const t = useT();
  const { can } = useAuthorization();
  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar px-3 py-5">
      <Logo />
      <nav className="flex-1 space-y-6 overflow-y-auto">
        <NavSection title={t('nav.content')} items={contentNav} />
        {can('backoffice:access') && <NavSection title={t('nav.backoffice')} items={adminNav} />}
        {can('backoffice:access') && <NavSection title={t('smart.name')} items={smartNav} />}
      </nav>
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
      <Dropdown.Trigger className="flex items-center gap-2 rounded-full p-1 pe-3 text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-sm font-semibold text-white">
          {user.name.slice(0, 1)}
        </span>
        <span className="hidden text-start sm:block">
          <span className="block font-medium leading-tight">{user.name}</span>
          <span className="block text-xs text-muted-foreground">
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
            <span className={cn(theme === value && 'font-semibold text-primary')}>
              {t(`nav.${value}`)}
            </span>
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
  const { sidebarOpen, setSidebarOpen } = useUi();
  const location = useLocation();

  useEffect(() => setSidebarOpen(false), [location.pathname, setSidebarOpen]);

  return (
    <div className="flex min-h-screen w-full">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {/* mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 shadow-2xl">
            <Sidebar />
            <button
              className="absolute end-3 top-5 rounded-md p-1 text-sidebar-foreground hover:bg-white/10"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="size-5" />
            </button>
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:ps-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <button
            className="rounded-md p-2 hover:bg-muted lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <SmartToggle />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
        <SmartRoot />
      </div>
    </div>
  );
}
