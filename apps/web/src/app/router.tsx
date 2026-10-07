import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { paths } from '@/config/paths';
import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { PageSpinner } from '@/components/ui/spinner';
import { Authorization, ProtectedRoute } from '@/lib/auth';
import { NotFoundRoute } from './routes/not-found';

/** Lazy route modules keep the initial bundle small (bulletproof-react pattern). */
const lazyRoute = (loader: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await loader()).default,
});

function AppRoot() {
  return (
    <ProtectedRoute>
      <DashboardLayout>
        <Outlet />
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function AdminOnly() {
  return (
    <Authorization
      policy="backoffice:access"
      fallback={<Navigate to={paths.app.dashboard.getHref()} replace />}
    >
      <Outlet />
    </Authorization>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Navigate to={paths.app.root.getHref()} replace /> },
  { path: paths.auth.login.path, lazy: lazyRoute(() => import('./routes/auth/login')) },
  { path: paths.auth.loginUp.path, lazy: lazyRoute(() => import('./routes/auth/login-up')) },
  {
    path: paths.app.root.path,
    element: <AppRoot />,
    hydrateFallbackElement: <PageSpinner />,
    children: [
      { index: true, lazy: lazyRoute(() => import('./routes/app/dashboard')) },
      { path: paths.app.topics.path, lazy: lazyRoute(() => import('./routes/app/topics/topics')) },
      { path: paths.app.topic.path, lazy: lazyRoute(() => import('./routes/app/topics/topic')) },
      {
        path: paths.app.businesses.path,
        lazy: lazyRoute(() => import('./routes/app/businesses/businesses')),
      },
      {
        path: paths.app.discovery.path,
        lazy: lazyRoute(() => import('./routes/app/businesses/discovery')),
      },
      {
        path: paths.app.business.path,
        lazy: lazyRoute(() => import('./routes/app/businesses/business')),
      },
      {
        path: paths.app.contents.path,
        lazy: lazyRoute(() => import('./routes/app/contents/contents')),
      },
      { path: paths.app.search.path, lazy: lazyRoute(() => import('./routes/app/search')) },
      {
        path: paths.app.calendar.path,
        lazy: lazyRoute(() => import('./routes/app/calendar/calendar')),
      },
      {
        path: paths.app.content.path,
        lazy: lazyRoute(() => import('./routes/app/contents/content')),
      },
      { path: paths.app.account.path, lazy: lazyRoute(() => import('./routes/app/account')) },
      {
        element: <AdminOnly />,
        children: [
          {
            path: paths.app.admin.users.path,
            lazy: lazyRoute(() => import('./routes/app/admin/users')),
          },
          {
            path: paths.app.admin.jobs.path,
            lazy: lazyRoute(() => import('./routes/app/admin/jobs')),
          },
          {
            path: paths.app.admin.prompts.path,
            lazy: lazyRoute(() => import('./routes/app/admin/prompts')),
          },
          {
            path: paths.app.admin.principles.path,
            lazy: lazyRoute(() => import('./routes/app/admin/principles')),
          },
          {
            path: paths.app.admin.settings.path,
            lazy: lazyRoute(() => import('./routes/app/admin/settings')),
          },
          {
            path: paths.app.admin.audit.path,
            lazy: lazyRoute(() => import('./routes/app/admin/audit')),
          },
          {
            path: paths.app.admin.smartErrors.path,
            lazy: lazyRoute(() => import('./routes/app/admin/smart-errors')),
          },
          {
            path: paths.app.admin.smartIssues.path,
            lazy: lazyRoute(() => import('./routes/app/admin/smart-issues')),
          },
          {
            path: paths.app.admin.smartInteractions.path,
            lazy: lazyRoute(() => import('./routes/app/admin/smart-interactions')),
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundRoute /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
