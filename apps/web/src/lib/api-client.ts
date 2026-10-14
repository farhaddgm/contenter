import type { ApiErrorBody, AuthResponse } from '@contenter/shared';
import { env } from '@/config/env';
import { useAuthStore } from '@/stores/auth';
import { smartBus } from './smart-bus';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: ApiErrorBody['errors'],
    public readonly errorId?: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  body?: unknown;
  params?: Params;
  signal?: AbortSignal;
  /** internal: skip the refresh-and-retry dance */
  skipRefresh?: boolean;
  /** The success response is a file, not JSON (bulk export). */
  file?: boolean;
}

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** The name from `Content-Disposition`, preferring the UTF-8 `filename*`. */
export function fileNameOf(header: string | null, fallback = 'download'): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      /* fall through to the plain name */
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

function buildUrl(path: string, params?: Params) {
  const url = `${env.API_URL}${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${env.API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return false;
      const data = (await res.json()) as AuthResponse;
      useAuthStore.getState().setSession(data.accessToken, data.user);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  // FormData (file uploads) is sent as is: the browser sets the multipart boundary header.
  const form = opts.body instanceof FormData ? opts.body : null;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.params), {
      method,
      credentials: 'include',
      signal: opts.signal,
      headers: {
        Accept: opts.file ? '*/*' : 'application/json',
        // lets the server attach the current page to interaction logs and errors
        'X-Client-Route': window.location.pathname,
        ...(opts.body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch (err) {
    if (
      !(err instanceof DOMException && err.name === 'AbortError') &&
      !path.startsWith('/smart/')
    ) {
      smartBus.emit({
        type: 'client-error',
        kind: 'api',
        message: `Network error: ${method} ${path}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  if (res.status === 401 && !opts.skipRefresh && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, path, { ...opts, skipRefresh: true });
    useAuthStore.getState().clear();
  }

  if (opts.file && res.ok) {
    const file: DownloadedFile = {
      blob: await res.blob(),
      fileName: fileNameOf(res.headers.get('Content-Disposition')),
    };
    return file as T;
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    if (res.status >= 500 && body?.errorId) {
      smartBus.emit({
        type: 'server-error',
        errorId: body.errorId,
        message: body.message ?? res.statusText,
        status: res.status,
        path: `${method} ${path}`,
      });
    }
    throw new ApiError(res.status, body?.message ?? res.statusText, body?.errors, body?.errorId);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Params, signal?: AbortSignal) =>
    request<T>('GET', path, { params, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  /** POST that answers with a file (kept as a Blob with the server's file name). */
  download: (path: string, body: unknown) =>
    request<DownloadedFile>('POST', path, { body, file: true }),
};
