import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';

let ensureFrameworkMetadataTablePromise: Promise<void> | null = null;

export type FrameworkMetadataEntry = {
  id: string;
  userId: string;
  userEmail: string | null;
  workspaceId: string;
  workspaceName: string | null;
  contentItemId: string | null;
  eventName: string;
  frameworkId: string;
  frameworkName: string;
  frameworkCategory: string;
  selectionMode: string;
  selectionReason: string | null;
  goal: string | null;
  platform: string | null;
  funnelStage: string | null;
  qualityScores: any;
  fallbackUsed: boolean;
  fallbackFrameworkId: string | null;
  metadata: any;
  createdAt: Date;
};

export type FrameworkUsageSummary = {
  frameworkId: string;
  frameworkName: string;
  events: number;
  fallbackEvents: number;
  avgOverallScore: number | null;
};

async function ensureFrameworkMetadataTable(): Promise<void> {
  if (ensureFrameworkMetadataTablePromise) return ensureFrameworkMetadataTablePromise;

  ensureFrameworkMetadataTablePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS content_framework_metadata (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        content_item_id TEXT NULL,
        event_name TEXT NOT NULL,
        framework_id TEXT NOT NULL,
        framework_name TEXT NOT NULL,
        framework_category TEXT NOT NULL,
        selection_mode TEXT NOT NULL DEFAULT 'auto',
        selection_reason TEXT NULL,
        goal TEXT NULL,
        platform TEXT NULL,
        funnel_stage TEXT NULL,
        quality_scores JSONB NULL,
        fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
        fallback_framework_id TEXT NULL,
        metadata JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_framework_metadata_created
      ON content_framework_metadata(created_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_framework_metadata_workspace_created
      ON content_framework_metadata(workspace_id, created_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_framework_metadata_content_item_created
      ON content_framework_metadata(content_item_id, created_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_framework_metadata_framework_created
      ON content_framework_metadata(framework_id, created_at DESC)
    `);
  })().catch((error) => {
    ensureFrameworkMetadataTablePromise = null;
    throw error;
  });

  return ensureFrameworkMetadataTablePromise;
}

export async function logFrameworkMetadata(input: {
  userId: string;
  workspaceId: string;
  contentItemId?: string | null;
  eventName: string;
  frameworkId: string;
  frameworkName: string;
  frameworkCategory: string;
  selectionMode?: string | null;
  selectionReason?: string | null;
  goal?: string | null;
  platform?: string | null;
  funnelStage?: string | null;
  qualityScores?: any;
  fallbackUsed?: boolean;
  fallbackFrameworkId?: string | null;
  metadata?: any;
}): Promise<void> {
  try {
    await ensureFrameworkMetadataTable();
    await prisma.$executeRaw`
      INSERT INTO content_framework_metadata (
        id,
        user_id,
        workspace_id,
        content_item_id,
        event_name,
        framework_id,
        framework_name,
        framework_category,
        selection_mode,
        selection_reason,
        goal,
        platform,
        funnel_stage,
        quality_scores,
        fallback_used,
        fallback_framework_id,
        metadata,
        created_at
      )
      VALUES (
        ${randomUUID()},
        ${input.userId},
        ${input.workspaceId},
        ${input.contentItemId || null},
        ${input.eventName},
        ${input.frameworkId},
        ${input.frameworkName},
        ${input.frameworkCategory},
        ${String(input.selectionMode || 'auto')},
        ${input.selectionReason || null},
        ${input.goal || null},
        ${input.platform || null},
        ${input.funnelStage || null},
        ${input.qualityScores ? JSON.stringify(input.qualityScores) : null}::jsonb,
        ${Boolean(input.fallbackUsed)},
        ${input.fallbackFrameworkId || null},
        ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
        NOW()
      )
    `;
  } catch (error) {
    console.error('logFrameworkMetadata failed:', error);
  }
}

export async function getLatestFrameworkMetadataForContentItem(
  userId: string,
  contentItemId: string,
): Promise<FrameworkMetadataEntry | null> {
  await ensureFrameworkMetadataTable();

  const rows = await prisma.$queryRaw<FrameworkMetadataEntry[]>`
    SELECT
      m.id,
      m.user_id AS "userId",
      u.email AS "userEmail",
      m.workspace_id AS "workspaceId",
      w.name AS "workspaceName",
      m.content_item_id AS "contentItemId",
      m.event_name AS "eventName",
      m.framework_id AS "frameworkId",
      m.framework_name AS "frameworkName",
      m.framework_category AS "frameworkCategory",
      m.selection_mode AS "selectionMode",
      m.selection_reason AS "selectionReason",
      m.goal,
      m.platform,
      m.funnel_stage AS "funnelStage",
      m.quality_scores AS "qualityScores",
      m.fallback_used AS "fallbackUsed",
      m.fallback_framework_id AS "fallbackFrameworkId",
      m.metadata,
      m.created_at AS "createdAt"
    FROM content_framework_metadata m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${userId}
      AND m.content_item_id = ${contentItemId}
    ORDER BY m.created_at DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

export async function listRecentFrameworkMetadata(limit = 120): Promise<FrameworkMetadataEntry[]> {
  await ensureFrameworkMetadataTable();

  return prisma.$queryRaw<FrameworkMetadataEntry[]>`
    SELECT
      m.id,
      m.user_id AS "userId",
      u.email AS "userEmail",
      m.workspace_id AS "workspaceId",
      w.name AS "workspaceName",
      m.content_item_id AS "contentItemId",
      m.event_name AS "eventName",
      m.framework_id AS "frameworkId",
      m.framework_name AS "frameworkName",
      m.framework_category AS "frameworkCategory",
      m.selection_mode AS "selectionMode",
      m.selection_reason AS "selectionReason",
      m.goal,
      m.platform,
      m.funnel_stage AS "funnelStage",
      m.quality_scores AS "qualityScores",
      m.fallback_used AS "fallbackUsed",
      m.fallback_framework_id AS "fallbackFrameworkId",
      m.metadata,
      m.created_at AS "createdAt"
    FROM content_framework_metadata m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN workspaces w ON w.id = m.workspace_id
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `;
}

export async function getFrameworkUsageSummary(days = 30): Promise<FrameworkUsageSummary[]> {
  await ensureFrameworkMetadataTable();

  return prisma.$queryRaw<FrameworkUsageSummary[]>`
    SELECT
      m.framework_id AS "frameworkId",
      MAX(m.framework_name) AS "frameworkName",
      COUNT(*)::int AS "events",
      COUNT(*) FILTER (WHERE m.fallback_used = TRUE)::int AS "fallbackEvents",
      AVG((m.quality_scores ->> 'overall_score')::numeric)::float AS "avgOverallScore"
    FROM content_framework_metadata m
    WHERE m.created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY m.framework_id
    ORDER BY "events" DESC
  `;
}
