import 'dotenv/config';
import { z } from 'zod';

/**
 * Coerces the common truthy string representations that arrive through
 * environment variables ("true", "1", "yes") into a real boolean.
 */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === 'true' || value === '1' || value === 'yes')
  .default(false);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('24h'),

  RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().max(24 * 60).default(30),
  MAX_HOLD_QUANTITY: z.coerce.number().int().positive().max(1000).default(5),

  GEO_DEFAULT_RADIUS_KM: z.coerce.number().positive().default(5),
  GEO_MAX_RADIUS_KM: z.coerce.number().positive().default(50),
  GEO_MAX_RESULTS: z.coerce.number().int().positive().default(100),

  BATCH_SYNC_MAX_ITEMS: z.coerce.number().int().positive().default(5000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),

  RUN_WORKER_IN_PROCESS: boolish,
  EXPIRY_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(200).default(10),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    '❌ Invalid environment configuration:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  process.exit(1);
}

export const env: Env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
