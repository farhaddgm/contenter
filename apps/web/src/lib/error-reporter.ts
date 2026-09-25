/**
 * Captures browser errors (window errors, unhandled rejections, render crashes, network
 * failures) and reports them to the Smart error tracker. Installed once at startup,
 * outside React, so it keeps working even when the UI tree has crashed.
 */
import { useAuthStore } from '@/stores/auth';
import { api } from './api-client';
import { smartBus } from './smart-bus';

const DEDUPE_MS = 10_000;
const recent = new Map<string, number>();
let installed = false;

async function report(e: {
  message: string;
  detail?: string;
  kind: 'runtime' | 'promise' | 'render' | 'api';
}) {
  if (!useAuthStore.getState().accessToken) return; // the endpoint needs a session
  const key = `${e.kind}:${e.message}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - DEDUPE_MS) return;
  recent.set(key, now);
  try {
    const { id } = await api.post<{ id: string | null }>('/smart/errors', {
      message: e.message.slice(0, 2000),
      detail: e.detail?.slice(0, 20_000),
      kind: e.kind,
      route: window.location.pathname,
    });
    if (id)
      smartBus.emit({ type: 'error-recorded', errorId: id, message: e.message, source: 'CLIENT' });
  } catch {
    /* never report errors about reporting errors */
  }
}

export function installErrorReporter() {
  if (installed) return;
  installed = true;

  smartBus.on((e) => {
    if (e.type === 'client-error') void report(e);
    if (e.type === 'server-error') {
      smartBus.emit({
        type: 'error-recorded',
        errorId: e.errorId,
        message: e.message,
        source: 'SERVER',
      });
    }
  });

  window.addEventListener('error', (ev) => {
    // ignore resource load errors (img/script) that have no Error object
    if (!ev.error && !ev.message) return;
    void report({
      kind: 'runtime',
      message: ev.message || String(ev.error),
      detail:
        ev.error instanceof Error ? ev.error.stack : `${ev.filename}:${ev.lineno}:${ev.colno}`,
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    // API errors are handled by react-query/UI; only report unexpected rejections
    if (reason && typeof reason === 'object' && 'status' in reason) return;
    void report({
      kind: 'promise',
      message: reason instanceof Error ? reason.message : String(reason),
      detail: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
