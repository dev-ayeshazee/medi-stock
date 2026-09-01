import Redis, { type RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { env, isProd } from './env';

/**
 * Base options shared by every ioredis connection in the process.
 *
 * `maxRetriesPerRequest: null` and `enableReadyCheck: false` are mandatory for
 * any connection handed to BullMQ; we use the same options everywhere for
 * consistency.
 */
export const baseRedisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  lazyConnect: false,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
};

function createClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    ...baseRedisOptions,
    connectionName: `medistock:${name}`,
  });

  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[redis:${name}] ${err.message}`);
  });

  return client;
}

declare global {
  // eslint-disable-next-line no-var
  var __medistockRedis: Redis | undefined;
}

/** Primary application connection: GEO index, stock hashes, Lua scripts. */
export const redis: Redis = global.__medistockRedis ?? createClient('app');

if (!isProd) {
  global.__medistockRedis = redis;
}

/** Dedicated connections should be created for pub/sub or blocking workloads. */
export function createRedisClient(name: string): Redis {
  return createClient(name);
}

/**
 * BullMQ prefers plain connection options (it duplicates connections internally
 * for blocking commands). We translate REDIS_URL once here.
 */
export function bullConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  const db = url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isNaN(db) ? 0 : db,
    maxRetriesPerRequest: null,
  };
}

// ── Key helpers ────────────────────────────────────────────────────────────

/** Sorted-set that backs Redis GEOSEARCH for verified pharmacies. */
export const PHARMACY_GEO_KEY = 'medistock:pharmacy:geo';

/** Per-inventory-row stock hash: fields `total` and `held`. */
export const stockKey = (inventoryId: string): string => `medistock:stock:${inventoryId}`;

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
