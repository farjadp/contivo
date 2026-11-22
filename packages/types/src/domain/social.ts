/**
 * social.ts — Domain types for social media publishing.
 *
 * These mirror the Prisma models (SocialConnection, SocialPublishJob,
 * SocialPublishLog) and are used throughout the API and web app.
 *
 * All token fields are omitted intentionally — tokens never leave the backend.
 */

import { z } from 'zod';

import type { ContentChannel } from './content';

// ─── Enums ────────────────────────────────────────────────────────────────────

// Must match `enum SocialPlatform` in apps/api/prisma/schema.prisma.
export const SocialPlatform = z.enum([
  'LINKEDIN',
  'X',
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'TELEGRAM',
  'THREADS',
]);
export type SocialPlatform = z.infer<typeof SocialPlatform>;

/** Every SocialPlatform value, in schema order. Iterate this; do not copy the list. */
export const PLATFORM_KEYS: readonly SocialPlatform[] = SocialPlatform.options;

/**
 * The one channel → platform table. `null` = the channel is not published
 * through a SocialConnection (`blog` belongs to the web Content-API publisher;
 * `email` has no sender yet). Typed as a full Record so adding a ContentChannel
 * without deciding its platform is a compile error.
 */
export const CHANNEL_TO_PLATFORM: Readonly<Record<ContentChannel, SocialPlatform | null>> = {
  linkedin: 'LINKEDIN',
  twitter: 'X',
  instagram: 'INSTAGRAM',
  telegram: 'TELEGRAM',
  threads: 'THREADS',
  blog: null,
  email: null,
};

// ─── Publish failure codes ────────────────────────────────────────────────────

/**
 * Every failure the API publish core writes to ContentItem.failedReason and
 * SocialPublishJob.lastError starts with one of these in brackets:
 * `[CONNECTION_EXPIRED] LinkedIn rejected the access token (401). …`.
 * The UI localises on the code and may show the English detail as secondary.
 * Rows written before codes existed have none: parseFailure → code null.
 *
 * - CONNECTION_EXPIRED: token expired / refresh refused / token missing → reconnect.
 * - CONNECTION_REVOKED: access withdrawn (403, bot removed) → reconnect.
 * - NO_CONNECTION: no default connected account for the channel → connect one.
 * - NO_SITE: blog channel with no active site connection (web publisher; not yet written with a code).
 * - NO_PUBLISHER: channel or platform Contivo cannot publish to yet.
 * - INVALID_CONTENT: empty body / fails the platform's rules.
 * - RATE_LIMITED: platform said slow down, still limited after the last retry.
 * - CREDITS_EXHAUSTED: platform billing (X pay-per-use credits) ran out.
 * - UNREACHABLE: platform could not be reached after the last retry.
 * - PLATFORM_ERROR: anything else the platform rejected.
 */
export const PUBLISH_FAILURE_CODES = [
  'CONNECTION_EXPIRED',
  'CONNECTION_REVOKED',
  'NO_CONNECTION',
  'NO_SITE',
  'NO_PUBLISHER',
  'INVALID_CONTENT',
  'RATE_LIMITED',
  'CREDITS_EXHAUSTED',
  'UNREACHABLE',
  'PLATFORM_ERROR',
] as const;
export type PublishFailureCode = (typeof PUBLISH_FAILURE_CODES)[number];

const FAILURE_PREFIX = /^\[([A-Z_]+)\]\s*/;

function isFailureCode(value: string): value is PublishFailureCode {
  return (PUBLISH_FAILURE_CODES as readonly string[]).includes(value);
}

/** `[CODE] detail`. A detail that already carries a known code keeps it. */
export function formatFailure(code: PublishFailureCode, detail: string): string {
  const existing = FAILURE_PREFIX.exec(detail);
  if (existing && isFailureCode(existing[1])) return detail;
  return `[${code}] ${detail}`;
}

/** Splits a stored reason. Unknown or missing codes give `code: null`, detail unchanged. */
export function parseFailure(reason: string | null | undefined): { code: PublishFailureCode | null; detail: string } {
  const text = reason ?? '';
  const match = FAILURE_PREFIX.exec(text);
  if (match && isFailureCode(match[1])) {
    return { code: match[1], detail: text.slice(match[0].length) };
  }
  return { code: null, detail: text };
}

export const SocialConnectionStatus = z.enum([
  'CONNECTED',
  'EXPIRED',
  'FAILED',
  'REVOKED',
  'PENDING_REAUTH',
]);
export type SocialConnectionStatus = z.infer<typeof SocialConnectionStatus>;

export const SocialPublishStatus = z.enum([
  'DRAFT',
  'READY',
  'SCHEDULED',
  'PUBLISH_QUEUED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
]);
export type SocialPublishStatus = z.infer<typeof SocialPublishStatus>;

// ─── Domain Shapes ────────────────────────────────────────────────────────────

/** Safe representation of a social connection — no tokens exposed. */
export const SocialConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  platform: SocialPlatform,
  accountName: z.string(),
  accountIdentifier: z.string(),
  authProvider: z.string(),
  scopesJson: z.array(z.string()).nullable(),
  status: SocialConnectionStatus,
  isDefault: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lastSyncAt: z.coerce.date().nullable(),
});
export type SocialConnection = z.infer<typeof SocialConnectionSchema>;

/** A single publish job record. */
export const SocialPublishJobSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  contentItemId: z.string().nullable(),
  socialConnectionId: z.string(),
  platform: SocialPlatform,
  scheduledAtUtc: z.coerce.date().nullable(),
  timezone: z.string().nullable(),
  status: SocialPublishStatus,
  externalPostId: z.string().nullable(),
  externalPostUrl: z.string().nullable(),
  lastError: z.string().nullable(),
  retryCount: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  publishedAtUtc: z.coerce.date().nullable(),
});
export type SocialPublishJob = z.infer<typeof SocialPublishJobSchema>;

/** Append-only audit log for publish job actions. */
export const SocialPublishLogSchema = z.object({
  id: z.string(),
  publishJobId: z.string(),
  action: z.string(),
  status: z.string(),
  requestSummary: z.string().nullable(),
  responseSummary: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type SocialPublishLog = z.infer<typeof SocialPublishLogSchema>;
