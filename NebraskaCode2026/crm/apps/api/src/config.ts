import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().default('postgres://localhost:5432/crm'),
  SESSION_SECRET: z.string().min(32).default('dev-only-secret-dev-only-secret-dev'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'fake']).default('auto'),
  AI_MODEL: z.string().default('claude-opus-4-8'),
  JOBS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  /** Max connections in the pg pool (per process). */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * How long a session/API-key auth context may be served from memory.
   * Logout invalidates immediately; role edits propagate within this TTL.
   * 0 disables (tests run with 0 so permission changes apply instantly).
   */
  AUTH_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}
