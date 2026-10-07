import { z } from 'zod';

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const optionalString = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** api = HTTP only, worker = queue consumer only, all = both (local dev) */
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().default(30),
  COOKIE_SECURE: bool('false'),
  /** Public origin of the web app; the Google callback redirects back here. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** The application owner: always an ADMIN and the only one who manages Google access. */
  OWNER_EMAIL: z
    .string()
    .email()
    .default('farhad.dgm@gmail.com')
    .transform((v) => v.toLowerCase()),
  /** "Sign in with Google" (OAuth web client). Disabled unless all three are set. */
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /** Must match the redirect URI registered in Google Cloud, e.g. https://host/api/auth/google/callback */
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * "Connect Google account" for reading private Google Docs (same OAuth client as sign-in).
   * Default: GOOGLE_REDIRECT_URI with `/auth/google/callback` → `/google-drive/callback`.
   */
  GOOGLE_DRIVE_REDIRECT_URI: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Bearer token of the read-only service API other applications (Docoo) use to read businesses
   * (docs/18-docoo-integration.md). Empty = the API is switched off. At least 32 characters.
   */
  INTEGRATION_TOKEN: z
    .string()
    .min(32)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Independent, least-privilege business reader; never share Docoo credentials. */
  RESEARCHER_INTEGRATION_TOKEN: z
    .string()
    .min(32)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Explicit business IDs; empty means deny all. Wildcards are not supported. */
  RESEARCHER_BUSINESS_ACCESS: z.enum(['selected', 'all']).default('selected'),
  RESEARCHER_BUSINESS_IDS: z.string().default('').transform((value) =>
    [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))],
  ).refine((ids) => ids.every((id) => /^[A-Za-z0-9_-]{1,128}$/u.test(id)),
    'Business IDs must be explicit identifiers, not wildcards'),
  /** Encrypts stored OAuth refresh tokens. Default: derived from JWT_REFRESH_SECRET. */
  DATA_ENCRYPTION_KEY: z
    .string()
    .min(16)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * mock = placeholder output, no vendor calls. Any other value = live: each task goes to the
   * vendor of the model chosen in the back office (`anthropic`/`openai` are kept as aliases).
   */
  AI_PROVIDER: z.enum(['live', 'anthropic', 'openai', 'mock']).default('live'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** Optional OpenAI-compatible endpoint (proxy / gateway). */
  OPENAI_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Used when no default model is saved in settings. `provider:model` or a bare id. */
  AI_DEFAULT_MODEL: z.string().default('claude-opus-5'),
  /** Server-side refusal fallback (beta `server-side-fallback-2026-07-01`). */
  AI_REFUSAL_FALLBACK: bool('true'),
  /** Where uploaded brand assets are stored (a volume shared by api and worker in Docker). */
  UPLOAD_DIR: z.string().default('uploads'),
  /** Largest accepted upload (videos). Keep nginx `client_max_body_size` at least this big. */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).default(200),
  FETCH_TIMEOUT_MS: z.coerce.number().int().default(15000),
  FETCH_MAX_BYTES: z.coerce.number().int().default(5_000_000),
  /**
   * Optional HTTP(S) proxy for outbound reads of links (references, samples, assets), e.g. a
   * small proxy on a server inside Iran: many Iranian services (PodSpace, …) do not answer
   * servers abroad, which shows up as a timeout. Empty = direct.
   */
  FETCH_PROXY_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Hosts sent through FETCH_PROXY_URL: comma-separated domain suffixes, `*` = every host. */
  FETCH_PROXY_HOSTS: z.string().default('ir'),
  /** Allow fetching private-network URLs (never enable in production). */
  FETCH_ALLOW_PRIVATE: bool('false'),
  /**
   * SMTP server for e-mail notifications (docs/25-notifications.md), e.g.
   * `smtps://user:password@smtp.example.com:465`. Empty = e-mail notifications are switched off;
   * the in-app list and the webhook still work.
   */
  SMTP_URL: z
    .string()
    .regex(/^smtps?:[/][/]/, 'must start with smtp:// or smtps://')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** The "From" of notification e-mails. */
  MAIL_FROM: z.string().default('Contenter <no-reply@localhost>'),
  SEED_ADMIN_EMAIL: z.string().default('admin@contenter.local'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMe123!'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
