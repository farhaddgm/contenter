/**
 * Client interaction tracker (page views, clicks, form submits, Walker actions).
 * Sends nothing unless the admin enabled "detailed interaction logging" in settings;
 * the server double-checks the setting before storing anything.
 */
import type { ClientEvent, InteractionType } from '@contenter/shared';
import { useAuthStore } from '@/stores/auth';
import { api } from './api-client';

const FLUSH_MS = 5_000;
const MAX_BATCH = 50;
const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);

let enabled = false;
let queue: ClientEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let listenersInstalled = false;

export function setTrackingEnabled(value: boolean) {
  enabled = value;
  if (!value) queue = [];
  if (value && !timer) timer = setInterval(() => void flush(), FLUSH_MS);
  if (!value && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function track(
  type: InteractionType,
  data: Omit<ClientEvent, 'type' | 'at' | 'route'> & { route?: string } = {},
) {
  if (!enabled) return;
  queue.push({
    type,
    route: data.route ?? window.location.pathname,
    target: data.target,
    meta: data.meta,
    at: new Date().toISOString(),
  });
  if (queue.length >= MAX_BATCH) void flush();
}

async function flush() {
  if (!queue.length || !useAuthStore.getState().accessToken) return;
  const events = queue.splice(0, MAX_BATCH);
  try {
    await api.post('/smart/events', { sessionId, events });
  } catch {
    /* telemetry is best-effort */
  }
}

function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  const text = (aria || el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 120) || el.tagName.toLowerCase();
}

/** Global click/submit listeners (installed once). Elements inside [data-no-track] are ignored. */
export function installInteractionListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener(
    'click',
    (ev) => {
      if (!enabled) return;
      const el = (ev.target as Element | null)?.closest(
        'button, a, [role="menuitem"], [role="tab"], [role="switch"]',
      );
      if (!el || el.closest('[data-no-track]')) return;
      const href = el.getAttribute('href');
      track('ui.click', { target: labelOf(el), meta: href ? { href } : undefined });
    },
    true,
  );
  document.addEventListener(
    'submit',
    (ev) => {
      if (!enabled) return;
      const form = ev.target as HTMLFormElement;
      if (form.closest('[data-no-track]')) return;
      track('ui.submit', { target: form.id || form.getAttribute('aria-label') || 'form' });
    },
    true,
  );
  window.addEventListener('beforeunload', () => void flush());
}
