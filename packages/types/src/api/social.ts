/**
 * social.ts — API request/response schemas for social publishing endpoints.
 *
 * Used by both the NestJS API (for validation DTOs) and the Next.js web app
 * (for typed fetch calls in api-client.ts and server actions).
 */

import { z } from 'zod';
import {
  SocialConnectionSchema,
  SocialPublishJobSchema,
  SocialPublishLogSchema,
  SocialPlatform,
} from '../domain/social';

// ─── Social Connections ───────────────────────────────────────────────────────

/** POST /social/connections — save a new OAuth-connected account */
export const CreateSocialConnectionRequestSchema = z.object({
  workspaceId: z.string(),
  platform: SocialPlatform,
  accountName: z.string().min(1),
  accountIdentifier: z.string().min(1),
  /** Raw access token — stored encrypted by the backend, never returned */
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  isDefault: z.boolean().optional().default(false),
});
export type CreateSocialConnectionRequest = z.infer<typeof CreateSocialConnectionRequestSchema>;

export const CreateSocialConnectionResponseSchema = z.object({
  connection: SocialConnectionSchema,
});
export type CreateSocialConnectionResponse = z.infer<typeof CreateSocialConnectionResponseSchema>;

/** GET /social/connections */
export const ListSocialConnectionsResponseSchema = z.object({
  connections: z.array(SocialConnectionSchema),
  total: z.number().int(),
});
export type ListSocialConnectionsResponse = z.infer<typeof ListSocialConnectionsResponseSchema>;

/** PATCH /social/connections/:id */
export const UpdateSocialConnectionRequestSchema = z.object({
  isDefault: z.boolean().optional(),
  accountName: z.string().optional(),
});
export type UpdateSocialConnectionRequest = z.infer<typeof UpdateSocialConnectionRequestSchema>;

// ─── Social Publish Jobs ──────────────────────────────────────────────────────

/** POST /social/publish-jobs — enqueue a new publish job */
export const CreatePublishJobRequestSchema = z.object({
  workspaceId: z.string(),
  contentItemId: z.string().optional(),
  socialConnectionId: z.string(),
  platform: SocialPlatform,
  /** Content body to publish */
  body: z.string().min(1).max(5000),
  /** Optional URL to attach (LinkedIn link posts, Facebook link posts) */
  linkUrl: z.string().url().optional(),
  /** Optional hashtags (without #) */
  hashtags: z.array(z.string()).optional().default([]),
  /** ISO-8601 UTC datetime string; omit for immediate publish */
  scheduledAtUtc: z.string().datetime().optional(),
  timezone: z.string().optional().default('UTC'),
});
export type CreatePublishJobRequest = z.infer<typeof CreatePublishJobRequestSchema>;

export const CreatePublishJobResponseSchema = z.object({
  job: SocialPublishJobSchema,
});
export type CreatePublishJobResponse = z.infer<typeof CreatePublishJobResponseSchema>;

/** GET /social/publish-jobs */
export const ListPublishJobsResponseSchema = z.object({
  jobs: z.array(SocialPublishJobSchema),
  total: z.number().int(),
});
export type ListPublishJobsResponse = z.infer<typeof ListPublishJobsResponseSchema>;

/** GET /social/publish-jobs/:id */
export const GetPublishJobDetailResponseSchema = z.object({
  job: SocialPublishJobSchema,
  logs: z.array(SocialPublishLogSchema),
});
export type GetPublishJobDetailResponse = z.infer<typeof GetPublishJobDetailResponseSchema>;

/** POST /social/publish-jobs/:id/retry */
export const RetryPublishJobResponseSchema = z.object({
  job: SocialPublishJobSchema,
});
export type RetryPublishJobResponse = z.infer<typeof RetryPublishJobResponseSchema>;
