import { z } from 'zod';

import { WorkspaceSchema } from '../domain/workspace';

// ─── Create workspace & start analysis ────────────────────────────────────────

export const StartGrowthEngineRequest = z.object({
  workspaceName: z.string().min(1).max(100),
  websiteUrl: z.string().url('Must be a valid URL'),
  businessDescription: z.string().max(2000).optional(),
  targetAudience: z.string().max(1000).optional(),
  competitors: z.array(z.string().url()).max(5).optional(),
});
export type StartGrowthEngineRequest = z.infer<typeof StartGrowthEngineRequest>;

// ─── Response ─────────────────────────────────────────────────────────────────

export const StartGrowthEngineResponse = z.object({
  workspace: WorkspaceSchema,
  jobId: z.string().cuid(),
  estimatedMinutes: z.number().int().min(1),
});
export type StartGrowthEngineResponse = z.infer<typeof StartGrowthEngineResponse>;

// ─── Strategy document ────────────────────────────────────────────────────────

export const ContentPillar = z.object({
  title: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
});
export type ContentPillar = z.infer<typeof ContentPillar>;

export const StrategyDocument = z.object({
  brandSummary: z.string(),
  targetAudience: z.object({
    description: z.string(),
    painPoints: z.array(z.string()),
    goals: z.array(z.string()),
  }),
  contentPillars: z.array(ContentPillar),
  recommendedChannels: z.array(z.string()),
  postingFrequency: z.record(z.string()),
  generatedAt: z.coerce.date(),
});
export type StrategyDocument = z.infer<typeof StrategyDocument>;

export const GrowthEngineStrategyResponse = z.object({
  workspaceId: z.string().cuid(),
  strategy: StrategyDocument,
});
export type GrowthEngineStrategyResponse = z.infer<typeof GrowthEngineStrategyResponse>;

// ─── Job status polling ───────────────────────────────────────────────────────

export const JobStatusResponse = z.object({
  jobId: z.string().cuid(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  progress: z.number().min(0).max(100).optional(),
  errorMessage: z.string().optional(),
  completedAt: z.coerce.date().optional(),
});
export type JobStatusResponse = z.infer<typeof JobStatusResponse>;
