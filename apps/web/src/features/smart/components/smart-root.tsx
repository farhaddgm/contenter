import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useAuthorization } from '@/lib/auth';
import { installInteractionListeners, setTrackingEnabled, track } from '@/lib/tracker';
import { smartBus } from '@/lib/smart-bus';
import { fetchErrorFeed, useSmartConfig } from '../api';
import { useSmart } from '../store';
import { topicIdFromPath } from '../walker-steps';
import { SmartPanel } from './smart-panel';
import { SmartToasts } from './smart-toasts';

const FEED_MS = 10_000;
const TOAST_DEDUPE_MS = 60_000;

/**
 * Mounted once inside the app shell:
 * - every user: interaction tracking (only if the admin enabled detailed logging);
 * - admins: error toasts (bus + server feed), Walker topic sync, and the floating panel.
 */
export function SmartRoot() {
  const location = useLocation();
  const { can } = useAuthorization();
  const isAdmin = can('backoffice:access');
  const enabled = useSmart((s) => s.enabled);
  const config = useSmartConfig();

  // ---- detailed interaction tracking ----
  useEffect(() => {
    installInteractionListeners();
  }, []);
  useEffect(() => {
    setTrackingEnabled(!!config.data?.detailedLogging);
  }, [config.data?.detailedLogging]);
  useEffect(() => {
    track('page.view', {
      route: location.pathname,
      meta: location.search ? { search: location.search } : undefined,
    });
  }, [location.pathname, location.search, config.data?.detailedLogging]);

  // ---- Walker follows the project the admin is looking at ----
  useEffect(() => {
    const id = topicIdFromPath(location.pathname);
    if (id) useSmart.getState().setWalkerTopic(id);
  }, [location.pathname]);

  // ---- error toasts: immediate (bus) + feed (server-side / AI job errors) ----
  const toasted = useRef(new Map<string, number>());
  useEffect(() => {
    if (!isAdmin) return;
    const shouldToast = (id: string) => {
      const now = Date.now();
      if ((toasted.current.get(id) ?? 0) > now - TOAST_DEDUPE_MS) return false;
      toasted.current.set(id, now);
      return useSmart.getState().enabled;
    };
    const off = smartBus.on((e) => {
      if (e.type === 'error-recorded' && shouldToast(e.errorId)) {
        useSmart.getState().pushToast({ errorId: e.errorId, message: e.message, source: e.source });
      }
    });
    let since = new Date().toISOString();
    const timer = setInterval(async () => {
      try {
        const items = await fetchErrorFeed(since);
        for (const err of items) {
          if (err.lastSeenAt > since) since = err.lastSeenAt;
          if (shouldToast(err.id))
            useSmart
              .getState()
              .pushToast({ errorId: err.id, message: err.message, source: err.source });
        }
      } catch {
        /* feed is best-effort */
      }
    }, FEED_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [isAdmin]);

  if (!isAdmin || !enabled) return null;
  return (
    <div data-no-track>
      <SmartPanel />
      <SmartToasts />
    </div>
  );
}
