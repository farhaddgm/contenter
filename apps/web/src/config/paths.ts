/** Central route map (bulletproof-react style) — never hardcode URLs in components. */
export const paths = {
  auth: {
    login: {
      path: '/auth/login',
      getHref: (redirectTo?: string | null) =>
        `/auth/login${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`,
    },
  },
  app: {
    root: { path: '/app', getHref: () => '/app' },
    dashboard: { path: '', getHref: () => '/app' },
    topics: { path: 'topics', getHref: () => '/app/topics' },
    topic: {
      path: 'topics/:topicId/:tab?',
      getHref: (id: string, tab?: string) => `/app/topics/${id}${tab ? `/${tab}` : ''}`,
    },
    businesses: { path: 'businesses', getHref: () => '/app/businesses' },
    business: {
      path: 'businesses/:businessId',
      getHref: (id: string) => `/app/businesses/${id}`,
    },
    discovery: {
      path: 'businesses/discover/:discoveryId',
      getHref: (id: string) => `/app/businesses/discover/${id}`,
    },
    contents: { path: 'contents', getHref: () => '/app/contents' },
    content: { path: 'contents/:contentId', getHref: (id: string) => `/app/contents/${id}` },
    account: { path: 'account', getHref: () => '/app/account' },
    admin: {
      users: { path: 'admin/users', getHref: () => '/app/admin/users' },
      jobs: { path: 'admin/jobs', getHref: () => '/app/admin/jobs' },
      prompts: { path: 'admin/prompts', getHref: () => '/app/admin/prompts' },
      principles: { path: 'admin/principles', getHref: () => '/app/admin/principles' },
      settings: { path: 'admin/settings', getHref: () => '/app/admin/settings' },
      audit: { path: 'admin/audit', getHref: () => '/app/admin/audit' },
      smartErrors: { path: 'admin/smart/errors', getHref: () => '/app/admin/smart/errors' },
      smartIssues: { path: 'admin/smart/issues', getHref: () => '/app/admin/smart/issues' },
      smartInteractions: {
        path: 'admin/smart/interactions',
        getHref: () => '/app/admin/smart/interactions',
      },
    },
  },
} as const;
