/**
 * token-refresh.service.ts
 *
 * Refreshes a connection's OAuth token shortly before it expires, so a
 * scheduled post does not fail on an X token that only lives two hours.
 *
 * Generic: the platform-specific grant is `adapter.refreshToken()`. Adapters
 * without it (LinkedIn — no refresh token in our scope) pass straight through.
 *
 * Lock: Redis `SET key token PX ttl NX` on the BullMQ ioredis connection, not
 * a Postgres advisory lock. A session advisory lock needs one pinned DB
 * connection, which Prisma's pool does not give us; `pg_advisory_xact_lock`
 * would hold a transaction open across an HTTP call to the platform. Redis is
 * already a hard dependency of publishing (no Redis, no queue, no publish),
 * and the TTL frees the lock if a worker dies mid-refresh.
 *
 * Why a lock at all: X rotates the refresh token on use. Two workers
 * refreshing at once means one of them presents an already-used token, gets
 * a 400, and — without the lock and the re-read below — marks a healthy
 * connection EXPIRED.
 */

import { randomBytes } from 'crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import type { SocialAdapter } from './adapters/social-adapter.interface';
import { PermanentPublishError, TransientPublishError } from './publish-errors';
import { SocialConnectionsService } from './social-connections.service';

/** Refresh when less than this is left on the access token. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export interface LockStore {
  /** Returns a release token when acquired, null when someone else holds it. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}

export const LOCK_STORE = Symbol('SOCIAL_LOCK_STORE');
export const TOKEN_REFRESH_OPTIONS = Symbol('TOKEN_REFRESH_OPTIONS');

interface RedisLike {
  set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/** Redis lock. Commands time out instead of queueing forever while Redis is down. */
export class RedisLockStore implements LockStore {
  constructor(private readonly redis: RedisLike, private readonly commandTimeoutMs = 3000) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomBytes(16).toString('hex');
    const res = await this.withTimeout(this.redis.set(key, token, 'PX', ttlMs, 'NX'));
    return res === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.withTimeout(this.redis.eval(RELEASE_SCRIPT, 1, key, token));
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Redis lock command timed out')), this.commandTimeoutMs);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}

export interface FreshTokens {
  accessToken?: string;
  refreshToken?: string;
}

interface Options {
  /** How long to wait for another worker's refresh. */
  waitMs: number;
  pollMs: number;
  lockTtlMs: number;
}

const DEFAULTS: Options = { waitMs: 15_000, pollMs: 250, lockTtlMs: 30_000 };

interface ConnectionRow {
  id: string;
  platform: string;
  accountIdentifier: string;
  status: string;
  encryptedAccessTokenRef: string | null;
  encryptedRefreshTokenRef: string | null;
  tokenExpiresAt: Date | null;
  metaJson?: unknown;
}

@Injectable()
export class TokenRefreshService {
  private readonly logger = new Logger(TokenRefreshService.name);
  private readonly opts: Options;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: SocialConnectionsService,
    @Inject(LOCK_STORE) private readonly locks: LockStore,
    @Optional() @Inject(TOKEN_REFRESH_OPTIONS) opts?: Partial<Options>,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Returns usable tokens for the connection, refreshing first when the
   * access token is inside the refresh window and the adapter can refresh.
   *
   * Throws TransientPublishError (retry later, status unchanged) or
   * PermanentPublishError (connection marked EXPIRED/REVOKED).
   */
  async ensureFreshToken(connectionId: string, adapter: SocialAdapter): Promise<FreshTokens> {
    if (adapter.credential !== 'stored_token') return {};

    let row = await this.read(connectionId);
    if (!adapter.refreshToken || !row.encryptedRefreshTokenRef || !this.needsRefresh(row)) {
      return this.decrypt(row);
    }

    const key = `social:token-refresh:${connectionId}`;
    const deadline = Date.now() + this.opts.waitMs;
    let lockToken: string | null = null;

    while (!lockToken) {
      try {
        lockToken = await this.locks.acquire(key, this.opts.lockTtlMs);
      } catch (err) {
        throw new TransientPublishError(`Could not take the token-refresh lock: ${(err as Error).message}`);
      }
      if (lockToken) break;

      // Another worker is refreshing this connection. Wait for its result.
      await new Promise((r) => setTimeout(r, this.opts.pollMs));
      row = await this.read(connectionId);
      if (!this.needsRefresh(row)) return this.decrypt(row);
      if (Date.now() > deadline) {
        throw new TransientPublishError(`Token refresh for connection ${connectionId} is still in progress elsewhere.`);
      }
    }

    try {
      // Double-check under the lock: the previous holder may have just finished.
      row = await this.read(connectionId);
      if (!this.needsRefresh(row)) return this.decrypt(row);

      const current = this.decrypt(row);
      const result = await adapter.refreshToken({
        id: row.id,
        platform: row.platform as SocialAdapter['platform'],
        accountIdentifier: row.accountIdentifier,
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
        meta: (row.metaJson as Record<string, unknown> | null) ?? undefined,
      });

      if (result.ok) {
        const refreshToken = result.refreshToken ?? current.refreshToken;
        // One statement: access, refresh and expiry change together or not at all.
        await this.prisma.socialConnection.update({
          where: { id: row.id },
          data: {
            encryptedAccessTokenRef: this.connections.encryptToken(result.accessToken),
            encryptedRefreshTokenRef: refreshToken ? this.connections.encryptToken(refreshToken) : null,
            tokenExpiresAt: result.expiresAt ?? null,
            lastSyncAt: new Date(),
          },
        });
        this.logger.log(`Refreshed ${row.platform} token for connection ${row.id}`);
        return { accessToken: result.accessToken, refreshToken };
      }

      if (result.reason === 'transient') {
        throw new TransientPublishError(result.detail);
      }

      // Rejected. Before blaming the user, check whether someone else rotated
      // the token between our read and the platform's answer.
      const after = await this.read(connectionId);
      if (after.encryptedRefreshTokenRef !== row.encryptedRefreshTokenRef || !this.needsRefresh(after)) {
        return this.decrypt(after);
      }

      const status = result.reason === 'revoked' ? 'REVOKED' : 'EXPIRED';
      await this.connections.markUnusable(row.id, status, result.detail);
      throw new PermanentPublishError(`${row.platform} connection ${status.toLowerCase()}: ${result.detail} Reconnect the account.`);
    } finally {
      await this.locks.release(key, lockToken).catch((err) =>
        this.logger.warn(`Could not release token-refresh lock ${key}: ${(err as Error).message}`),
      );
    }
  }

  private needsRefresh(row: ConnectionRow): boolean {
    if (!row.tokenExpiresAt) return false;
    return new Date(row.tokenExpiresAt).getTime() - Date.now() < REFRESH_WINDOW_MS;
  }

  private decrypt(row: ConnectionRow): FreshTokens {
    return {
      accessToken: row.encryptedAccessTokenRef ? this.connections.decryptToken(row.encryptedAccessTokenRef) : undefined,
      refreshToken: row.encryptedRefreshTokenRef ? this.connections.decryptToken(row.encryptedRefreshTokenRef) : undefined,
    };
  }

  private async read(connectionId: string): Promise<ConnectionRow> {
    const row = (await this.prisma.socialConnection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        platform: true,
        accountIdentifier: true,
        status: true,
        encryptedAccessTokenRef: true,
        encryptedRefreshTokenRef: true,
        tokenExpiresAt: true,
        metaJson: true,
      },
    })) as ConnectionRow | null;
    if (!row) throw new PermanentPublishError(`Social connection ${connectionId} no longer exists.`);
    return row;
  }
}
