/**
 * social-adapter.interface.ts
 *
 * Defines the contract that every platform-specific adapter must implement.
 * This ensures the publish service can swap adapters without any conditionals.
 *
 * Flow: SocialPublishService → AdapterFactory.getAdapter(platform) → adapter.publish()
 */

import { SocialPlatform } from '@contivo/types';

// ─── Shared payload types ─────────────────────────────────────────────────────

/** Sanitised connection data passed to adapters — no raw token fields. */
export interface AdapterConnection {
  id: string;
  platform: SocialPlatform;
  accountIdentifier: string; // handle / page-id / URN
  accessToken: string;       // decrypted at service layer before passing here
  refreshToken?: string;
}

/** Platform-agnostic publish payload. */
export interface PublishPayload {
  body: string;
  linkUrl?: string;
  hashtags?: string[];
  /** For Facebook: required page identifier */
  pageId?: string;
}

/** Normalised result returned by every adapter after a post attempt. */
export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalPostUrl?: string;
  error?: string;
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

  /**
   * Validates that the connection token is still active.
   * Should NOT throw — returns false on expired/invalid tokens.
   */
  validateConnection(connection: AdapterConnection): Promise<boolean>;

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
  ): Promise<PublishResult>;

  /**
   * Normalises a raw error from the platform SDK / fetch response
   * into a human-readable string safe to store in the DB.
   */
  normalizeError(raw: unknown): string;
}
