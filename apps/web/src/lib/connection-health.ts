/**
 * connection-health.ts
 *
 * What a social connection's status really is right now, as opposed to what
 * the row says.
 *
 * LinkedIn (scope w_member_social) issues no refresh token: a sign-in lasts
 * 60 days (apps/api/.../linkedin.adapter.ts) and then every publish fails. The
 * stored status only moves to EXPIRED after the API gets its first 401, so a
 * row can read CONNECTED for weeks after the token died. This module reads
 * `tokenExpiresAt` instead, so the user hears about it before a post fails.
 *
 * Pure and clock-injected. It never writes: status changes stay with the
 * API's 401 path.
 */

/** Warn this many days before a token runs out. */
export const EXPIRY_WARNING_DAYS = 7;

/**
 * Stable code stored in Autopilot run rows (`error`, log `code`) when a
 * LinkedIn channel is skipped because its sign-in has run out. Also the key
 * under `tabsA.autopilot.runCodes` that localises it. Do not rename.
 */
export const LINKEDIN_RECONNECT_REQUIRED = 'LINKEDIN_RECONNECT_REQUIRED';

/**
 * Platforms whose tokens cannot be refreshed without the user. X, Facebook
 * and TikTok refresh in the API (token-refresh.service.ts), so their short
 * `tokenExpiresAt` says nothing about whether they still work.
 */
const NO_REFRESH_PLATFORMS: ReadonlySet<string> = new Set(['LINKEDIN']);

const DAY_MS = 24 * 60 * 60 * 1000;

export type EffectiveConnectionStatus = {
  /** A stored SocialConnectionStatus, or EXPIRING_SOON. */
  status: string;
  /** Whole days left (rounded up) when EXPIRING_SOON; otherwise null. */
  daysLeft: number | null;
};

export type ConnectionExpiryInput = {
  platform: string;
  status: string;
  tokenExpiresAt: Date | string | null | undefined;
};

function expiryTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * - CONNECTED + expiry at or before `now` → EXPIRED;
 * - CONNECTED + expiry within EXPIRY_WARNING_DAYS → EXPIRING_SOON, daysLeft;
 * - anything else (no expiry, a refreshable platform, a row already EXPIRED /
 *   REVOKED / FAILED / PENDING_REAUTH) → as stored.
 */
export function effectiveConnectionStatus(
  connection: ConnectionExpiryInput,
  now: Date,
): EffectiveConnectionStatus {
  const stored: EffectiveConnectionStatus = { status: connection.status, daysLeft: null };
  if (connection.status !== 'CONNECTED') return stored;
  if (!NO_REFRESH_PLATFORMS.has(connection.platform.toUpperCase())) return stored;

  const expires = expiryTime(connection.tokenExpiresAt);
  if (expires == null) return stored;

  const left = expires - now.getTime();
  if (left <= 0) return { status: 'EXPIRED', daysLeft: null };
  if (left <= EXPIRY_WARNING_DAYS * DAY_MS) return { status: 'EXPIRING_SOON', daysLeft: Math.ceil(left / DAY_MS) };
  return stored;
}

/** A CONNECTED row whose sign-in has already run out: publishing will 401. */
export function isTokenExpired(connection: ConnectionExpiryInput, now: Date): boolean {
  return connection.status === 'CONNECTED' && effectiveConnectionStatus(connection, now).status === 'EXPIRED';
}

/**
 * Whether an Autopilot run skipped LinkedIn because its sign-in ran out:
 * the run's `error` is the code (nothing else was publishable), or a
 * `channel_skipped` log entry carries it (other channels still ran).
 */
export function runNeedsLinkedInReconnect(run: { error: string | null; log: unknown[] }): boolean {
  if (run.error === LINKEDIN_RECONNECT_REQUIRED) return true;
  return run.log.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { code?: unknown }).code === LINKEDIN_RECONNECT_REQUIRED,
  );
}
