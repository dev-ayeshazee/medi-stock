import fs from 'node:fs';
import path from 'node:path';
import type { Redis } from 'ioredis';
import { redis } from '../config/redis';

/**
 * Loads a `.lua` file from disk. Resolves against both the compiled (`dist`)
 * and source (`src`) trees so the same code works under `tsx` and `node dist`.
 */
function loadLua(fileName: string): string {
  const candidates = [
    path.resolve(__dirname, '../scripts/lua', fileName),
    path.resolve(process.cwd(), 'dist/scripts/lua', fileName),
    path.resolve(process.cwd(), 'src/scripts/lua', fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }

  throw new Error(`Lua script not found: ${fileName} (looked in ${candidates.join(', ')})`);
}

export const LUA = {
  holdStock: loadLua('holdStock.lua'),
  initStock: loadLua('initStock.lua'),
  releaseStock: loadLua('releaseStock.lua'),
  commitStock: loadLua('commitStock.lua'),
} as const;

declare module 'ioredis' {
  interface RedisCommander<Context> {
    /** @returns new `held` value, or -1 (missing key) / -2 (insufficient) / -3 (bad qty) */
    holdStock(key: string, quantity: number | string): Promise<number>;
    /** @returns 1 if the key was created, 0 if it already existed */
    initStock(key: string, total: number | string, held: number | string): Promise<number>;
    /** @returns new `held` value, or -1 (missing key) / -3 (bad qty) */
    releaseStock(key: string, quantity: number | string): Promise<number>;
    /** @returns `[newTotal, newHeld]`, or `[-1,-1]` / `[-3,-3]` */
    commitStock(key: string, quantity: number | string): Promise<[number, number]>;
  }
}

/**
 * Registers the Lua scripts as custom commands on a connection. Idempotent, so
 * it is safe to call for every connection that needs them.
 */
export function registerRedisScripts(client: Redis = redis): void {
  const anyClient = client as unknown as Record<string, unknown>;

  if (typeof anyClient.holdStock !== 'function') {
    client.defineCommand('holdStock', { numberOfKeys: 1, lua: LUA.holdStock });
  }
  if (typeof anyClient.initStock !== 'function') {
    client.defineCommand('initStock', { numberOfKeys: 1, lua: LUA.initStock });
  }
  if (typeof anyClient.releaseStock !== 'function') {
    client.defineCommand('releaseStock', { numberOfKeys: 1, lua: LUA.releaseStock });
  }
  if (typeof anyClient.commitStock !== 'function') {
    client.defineCommand('commitStock', { numberOfKeys: 1, lua: LUA.commitStock });
  }
}

// Register on the shared connection at import time.
registerRedisScripts(redis);
