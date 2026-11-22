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
