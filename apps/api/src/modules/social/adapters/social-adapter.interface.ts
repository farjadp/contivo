/**
 * social-adapter.interface.ts
 *
 * Defines the contract that every platform-specific adapter must implement.
 * This ensures the publish service can swap adapters without any conditionals.
 *
 * Flow: SocialPublishService → AdapterFactory.getAdapter(platform) → adapter.publish()
 */

import type { PublishFailureCode } from '@contivo/types';
import type { SocialPlatform } from '@prisma/client';

// ─── Shared payload types ─────────────────────────────────────────────────────

/**
 * Where an adapter's credential lives.
 * - `stored_token`: per-connection OAuth token in the encrypted columns.
 * - `platform_env`: one Contivo-owned credential in env (e.g. the Telegram bot);
 *   the connection row holds no secret and the service must not demand one.
 */
export type CredentialKind = 'stored_token' | 'platform_env';

/**
 * Result of a live token check.
 * - `expired`: the token no longer works; the user must reconnect (EXPIRED).
 * - `revoked`: the user or platform withdrew access (REVOKED).
 * - `transient`: network / 5xx / rate limit. Says nothing about the token, so
 *   the connection status must NOT change; the job is retried.
 */
export type ConnectionHealth =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'revoked' | 'transient'; detail: string; retryAfterSec?: number };

/** Result of a refresh-token grant. Same failure vocabulary as ConnectionHealth. */
export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken?: string; expiresAt?: Date }
  | { ok: false; reason: 'expired' | 'revoked' | 'transient'; detail: string };

/** Sanitised connection data passed to adapters — no raw token fields. */
export interface AdapterConnection {
  id: string;
  platform: SocialPlatform;
  accountIdentifier: string; // handle / page-id / URN
  /** Decrypted at the service layer. Absent for `platform_env` adapters. */
  accessToken?: string;
  refreshToken?: string;
  /** Non-secret per-connection settings (SocialConnection.metaJson). */
  meta?: Record<string, unknown>;
}

/** An image to publish alongside the post. */
export interface PublishImage {
  data: Buffer;
  mimeType: string;
  altText?: string;
}

/** Platform-agnostic publish payload. */
export interface PublishPayload {
  body: string;
  linkUrl?: string;
  hashtags?: string[];
  /** For Facebook: required page identifier */
  pageId?: string;
  /** Optional artwork; adapters that cannot post media ignore it. */
  image?: PublishImage;
  /** ContentItem.topic — used as a title by channels that have one. */
  title?: string;
  /** ContentItem.slug, when assigned. */
  slug?: string;
  /** How `body` is written. Content is authored as markdown. */
  format?: 'markdown';
}

/** Normalised result returned by every adapter after a post attempt. */
export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalPostUrl?: string;
  error?: string;
  /**
   * True only when the platform certainly did NOT create the post (rate limit,
   * request never left — DNS/connect failure). Ambiguous failures (5xx,
   * timeout after send) are false: a blind retry could post twice.
   */
  retryable?: boolean;
  /** Platform-provided wait before retrying (Retry-After / retry_after). */
  retryAfterSec?: number;
  /** Stable failure code for the UI; PLATFORM_ERROR when absent. */
  failureCode?: PublishFailureCode;
}

/**
 * Per-job state the service hands to adapters that post in several parts
 * (Telegram splits long posts). Lets a retry skip parts already delivered.
 */
export interface PublishContext {
  /** Parts delivered by an earlier attempt of this job: part index → platform message id. */
  sentParts: ReadonlyMap<number, string>;
  /**
   * Records one delivered part. Called before the next part is sent; if it
   * throws, the adapter must stop (a retry would otherwise post it twice).
   */
  recordPart(index: number, externalId: string): Promise<void>;
  /** The platform moved the account to a new id (Telegram group → supergroup). */
  updateAccountIdentifier(newIdentifier: string): Promise<void>;
}

/** Validation result returned before attempting publish. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface SocialAdapter {
  /** Which platform this adapter handles. */
  readonly platform: SocialPlatform;

  /** Where the credential comes from; decides whether a stored token is required. */
  readonly credential: CredentialKind;

  /**
   * For `platform_env` adapters: whether this deployment has the credential.
   * False makes the factory refuse the platform (NO_PUBLISHER) instead of
   * retrying a publish that cannot work. Absent = always configured.
   */
  isConfigured?(): boolean;

  /**
   * Checks the connection is usable. Never throws: network errors are
   * `transient`, never `expired`.
   */
  validateConnection(connection: AdapterConnection): Promise<ConnectionHealth>;

  /**
   * Optional refresh-token grant. Called by TokenRefreshService shortly before
   * expiry, under a per-connection lock. Never throws.
   */
  refreshToken?(connection: AdapterConnection): Promise<RefreshResult>;

  /**
   * Validates the publish payload against platform-specific rules
   * (character limits, required fields, etc.) BEFORE touching the API.
   * Must be synchronous and pure.
   */
  validatePayload(payload: PublishPayload): ValidationResult;

  /**
   * Publishes the payload to the social platform.
   * Returns a normalised PublishResult — never throws for API errors.
   * Adapter is responsible for normalising all platform error shapes.
   */
  publish(
    connection: AdapterConnection,
    payload: PublishPayload,
    context?: PublishContext,
  ): Promise<PublishResult>;

  /**
   * Normalises a raw error from the platform SDK / fetch response
   * into a human-readable string safe to store in the DB.
   */
  normalizeError(raw: unknown): string;
}
