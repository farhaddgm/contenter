import { z } from 'zod';

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

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
  AI_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().default('claude-opus-5'),
  /** Server-side refusal fallback (beta `server-side-fallback-2026-07-01`). */
  AI_REFUSAL_FALLBACK: bool('true'),
  FETCH_TIMEOUT_MS: z.coerce.number().int().default(15000),
  FETCH_MAX_BYTES: z.coerce.number().int().default(5_000_000),
  /** Allow fetching private-network URLs (never enable in production). */
  FETCH_ALLOW_PRIVATE: bool('false'),
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
