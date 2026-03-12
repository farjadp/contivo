import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const WorkspaceStatus = z.enum([
  'PENDING',      // Just created, waiting for crawl
  'CRAWLING',     // Website being crawled
  'ANALYZING',    // AI analysis running
  'READY',        // Strategy generated, workspace usable
  'ERROR',        // Analysis failed
]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatus>;

// ─── Domain type ──────────────────────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  name: z.string().min(1).max(100),
  websiteUrl: z.string().url().nullable(),
  status: WorkspaceStatus,
  brandSummary: z.record(z.unknown()).nullable(),
  audienceInsights: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

// ─── Request DTOs ─────────────────────────────────────────────────────────────

export const CreateWorkspaceRequest = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  websiteUrl: z.string().url('Must be a valid URL').optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

// ─── Response DTOs ────────────────────────────────────────────────────────────

export const WorkspaceSummaryResponse = WorkspaceSchema.pick({
  id: true,
  name: true,
  websiteUrl: true,
  status: true,
  createdAt: true,
});
export type WorkspaceSummaryResponse = z.infer<typeof WorkspaceSummaryResponse>;
