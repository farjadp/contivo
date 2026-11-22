/**
 * oauth-store.ts
 *
 * Short-lived server-side state for the OAuth connect flow, in Redis:
 *   - single-use OAuth state nonces (a replayed callback is refused);
 *   - pending connections waiting for the web session to confirm them
 *     (see SocialOAuthService.finalizeConnect);
 *   - Telegram connect sessions (telegram/telegram-connect.service.ts).
 *
 * Behind an interface so tests can use an in-memory store.
 */

import type Redis from 'ioredis';

export const OAUTH_STORE = Symbol('OAUTH_STORE');

export interface OAuthStore {
  /** True the first time a key is claimed within ttlMs, false afterwards. */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
  put(key: string, value: string, ttlMs: number): Promise<void>;
  /** Reads without consuming (Telegram connect sessions are polled). */
  get(key: string): Promise<string | null>;
  /** Removes a key; no-op when absent. */
  del(key: string): Promise<void>;
  /** Reads and deletes in one step, so a value can be taken only once. */
  take(key: string): Promise<string | null>;
}

export function redisOAuthStore(redis: Redis): OAuthStore {
  return {
    async claimOnce(key, ttlMs) {
      return (await redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    },
    async put(key, value, ttlMs) {
      await redis.set(key, value, 'PX', ttlMs);
    },
    async get(key) {
      return redis.get(key);
    },
    async del(key) {
      await redis.del(key);
    },
    async take(key) {
      // MULTI GET + DEL rather than GETDEL: works on Redis < 6.2 too.
      const res = await redis.multi().get(key).del(key).exec();
      if (!res) return null;
      const [getErr, value] = res[0];
      if (getErr) throw getErr;
      return (value as string | null) ?? null;
    },
  };
}

/** In-memory store for tests. */
export function memoryOAuthStore(): OAuthStore & { keys(): string[] } {
  const data = new Map<string, { value: string; exp: number }>();
  const live = (k: string) => {
    const hit = data.get(k);
    if (hit && hit.exp < Date.now()) data.delete(k);
    return data.get(k);
  };
  return {
    async claimOnce(key, ttlMs) {
      if (live(key)) return false;
      data.set(key, { value: '1', exp: Date.now() + ttlMs });
      return true;
    },
    async put(key, value, ttlMs) {
      data.set(key, { value, exp: Date.now() + ttlMs });
    },
    async get(key) {
      return live(key)?.value ?? null;
    },
    async del(key) {
      data.delete(key);
    },
    async take(key) {
      const hit = live(key);
      data.delete(key);
      return hit?.value ?? null;
    },
    keys: () => [...data.keys()],
  };
}
