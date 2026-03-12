import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const ContentChannel = z.enum([
  'linkedin',
  'twitter',
  'instagram',
  'email',
  'blog',
]);
export type ContentChannel = z.infer<typeof ContentChannel>;

export const ContentTone = z.enum([
  'professional',
  'friendly',
  'bold',
  'educational',
  'persuasive',
]);
export type ContentTone = z.infer<typeof ContentTone>;

export const ContentType = z.enum([
  'POST',
  'THREAD',
  'ARTICLE',
  'EMAIL',
  'CAPTION',
  'OUTLINE',
]);
export type ContentType = z.infer<typeof ContentType>;

export const ContentStatus = z.enum(['DRAFT', 'GENERATED', 'EDITED', 'EXPORTED']);
export type ContentStatus = z.infer<typeof ContentStatus>;

export const JobStatus = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobType = z.enum([
  'INSTANT_CONTENT',
  'WEBSITE_CRAWL',
  'BRAND_ANALYSIS',
  'STRATEGY_GENERATION',
  'ARTICLE_DRAFT',
]);
export type JobType = z.infer<typeof JobType>;

// ─── Domain shapes ────────────────────────────────────────────────────────────

export const ContentItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  type: ContentType,
  channel: ContentChannel,
  tone: ContentTone.nullable(),
  topic: z.string(),
  content: z.string(),
  status: ContentStatus,
  creditsCost: z.number().int(),
  jobId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const ContentJobSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  type: JobType,
  status: JobStatus,
  inputPayload: z.record(z.unknown()),
  outputPayload: z.record(z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  creditsCost: z.number().int(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type ContentJob = z.infer<typeof ContentJobSchema>;
