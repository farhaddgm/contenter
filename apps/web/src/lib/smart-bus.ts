/**
 * Tiny event bus that lets low-level code (api-client, error boundary, window handlers)
 * signal errors to the Smart feature without importing it.
 */
export type SmartBusEvent =
  /** A 5xx response; the server already recorded it as AppError `errorId`. */
  | { type: 'server-error'; errorId: string; message: string; status: number; path: string }
  /** A browser-side error that still has to be reported to the server. */
  | {
      type: 'client-error';
      message: string;
      detail?: string;
      kind: 'runtime' | 'promise' | 'render' | 'api';
    }
  /** An error is stored on the server — Smart may show a toast for it. */
  | { type: 'error-recorded'; errorId: string; message: string; source: 'SERVER' | 'CLIENT' };

type Listener = (e: SmartBusEvent) => void;
const listeners = new Set<Listener>();

export const smartBus = {
  emit(e: SmartBusEvent) {
    listeners.forEach((l) => {
      try {
        l(e);
      } catch {
        /* a listener must never break the emitter */
      }
    });
  },
  on(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
