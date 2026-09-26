/**
 * Pure helpers that turn a raw error into a category, a short Persian hint and a
 * stable fingerprint (so repeated occurrences are grouped into one AppError).
 */
import { createHash } from 'node:crypto';
import type { ErrorCategory, ErrorSource } from '@contenter/shared';

export interface ClassifyInput {
  source: ErrorSource;
  message: string;
  statusCode?: number | null;
  /** e.g. 'PrismaClientKnownRequestError', 'TypeError' */
  errorName?: string | null;
}

export function categorize(input: ClassifyInput): ErrorCategory {
  const msg = input.message.toLowerCase();
  const name = (input.errorName ?? '').toLowerCase();
  if (
    name.startsWith('prisma') ||
    /prisma|database|p\d{4}\b|relation .* does not exist/.test(msg)
  ) {
    return 'DATABASE';
  }
  if (
    input.source === 'AI_JOB' ||
    /anthropic|openai|model declined|max_tokens|model output|invalid json/.test(msg)
  ) {
    return 'AI';
  }
  const status = input.statusCode ?? 0;
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (/econnrefused|etimedout|enotfound|fetch failed|network|failed to fetch|timeout/.test(msg)) {
    return 'NETWORK';
  }
  if (input.source === 'CLIENT') return 'CLIENT_RUNTIME';
  return 'UNKNOWN';
}

const HINTS: Record<ErrorCategory, string> = {
  DATABASE:
    'خطا در ارتباط با پایگاه داده یا اجرای کوئری؛ اتصال DB، مایگریشن‌ها و داده‌های مرتبط را بررسی کنید.',
  VALIDATION: 'داده‌های ارسالی با قرارداد API هم‌خوانی ندارد.',
  AUTH: 'مشکل احراز هویت یا نداشتن دسترسی لازم.',
  NETWORK: 'ارتباط شبکه‌ای با سرور یا سرویس بیرونی برقرار نشد یا زمان آن تمام شد.',
  AI: 'کار هوش مصنوعی ناموفق بود؛ خروجی مدل، کلید API، محدودیت نرخ یا امتناع مدل را بررسی کنید.',
  NOT_FOUND: 'موجودیت یا مسیر درخواستی پیدا نشد.',
  CLIENT_RUNTIME: 'خطای اجرای کد در مرورگر (رابط کاربری).',
  UNKNOWN: 'خطای پیش‌بینی‌نشده؛ جزئیات و stack را بررسی کنید.',
};

export function hintFor(category: ErrorCategory): string {
  return HINTS[category];
}

/** Replaces ids, numbers and quoted values so similar errors collapse together. */
export function normalizeForFingerprint(text: string): string {
  return text
    .replace(/\bc[a-z0-9]{20,}\b/gi, ':id')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':uuid')
    .replace(/\d+/g, ':n')
    .replace(/(["'`]).*?\1/g, ':s')
    .trim()
    .slice(0, 500);
}

export function fingerprint(parts: {
  source: ErrorSource;
  category: ErrorCategory;
  message: string;
  path?: string | null;
}): string {
  const raw = [
    parts.source,
    parts.category,
    normalizeForFingerprint(parts.message),
    normalizeForFingerprint(parts.path ?? ''),
  ].join('|');
  return createHash('sha1').update(raw).digest('hex');
}

const SENSITIVE_KEY = /pass(word)?|token|secret|api[-_]?key|authorization|cookie/i;
const MAX_STRING = 500;

/** Deep-copies a payload for logging: redacts secrets, truncates long strings and big arrays. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    return value.length > 20 ? [...items, `…(${value.length - 20} more)`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}
