/**
 * next-step-load.ts
 *
 * Loads what the one next-step bar (lib/next-step.ts, spec first-post B §5)
 * needs on any surface: guided mode, the workspace's setup facts and its
 * first-post state. The workspace page, Today and Connections all call this,
 * so the bar cannot say different things on different pages.
 *
 * Server-only (database). Returns null when the kill switch is on: no bar.
 *
 * DEBT (spec §13): this is the third WorkspaceFacts builder, next to
 * growth/[id]/page.tsx and dashboard/page.tsx. It copies the workspace
 * page's rules (channel = CONNECTED + isDefault social, or an ACTIVE site;
 * storylines = all of them). Folding the three into one loadWorkspaceFacts is
 * about half a day and is deliberately not done in this task.
 */

import { countCompetitors } from '@/lib/competitor-counts';
import { prisma } from '@/lib/db';
import { loadFirstPostState, type FirstPostLoad } from '@/lib/first-post/load';
import { loadGuidedMode, readKillSwitch } from '@/lib/first-post/mode';
import type { NextStepSurface } from '@/lib/first-post/types';
import type { NextStepInput } from '@/lib/next-step';
import { matrixFacts, type WorkspaceFacts } from '@/lib/workspace-journey';

export type NextStepLoad = {
  /** Everything buildNextStep needs except `onFirstPostTab`, which only the page knows. */
  input: Omit<NextStepInput, 'onFirstPostTab'>;
  /** The full first-post read (draft, why facts), for the workspace page's FirstPostView. */
  firstPost: FirstPostLoad | null;
};

type WorkspaceRow = {
  id: string;
  brandSummary: unknown;
  audienceInsights: unknown;
  competitors: Array<{ userDecision: string | null }>;
};

type WorkspaceCounts = {
  connections: Array<{ platform: unknown }>;
  siteCount: number;
  autopilotEnabled: boolean;
  storylines: number;
  publishedCount: number;
  scheduledCount: number;
};

/** Pure: the same mapping growth/[id]/page.tsx does inline. */
export function workspaceFactsFrom(ws: WorkspaceRow, c: WorkspaceCounts): WorkspaceFacts {
  const insights =
    ws.audienceInsights && typeof ws.audienceInsights === 'object'
      ? (ws.audienceInsights as { competitorKeywordsIntel?: { competitors?: unknown } })
      : {};
  const keywordCompetitors = insights.competitorKeywordsIntel?.competitors;
  return {
    workspaceId: ws.id,
    hasBrandSummary: Boolean(ws.brandSummary),
    acceptedCompetitors: ws.competitors.filter((x) => x.userDecision === 'ACCEPTED').length,
    totalCompetitors: countCompetitors(ws.competitors),
    ...matrixFacts(ws.audienceInsights),
    keywordCompetitors: Array.isArray(keywordCompetitors) ? keywordCompetitors.length : 0,
    storylines: c.storylines,
    hasChannel: c.connections.length > 0 || c.siteCount > 0,
    channelLabel:
      c.connections.length > 0
        ? c.connections.map((x) => String(x.platform)).join(', ')
        : c.siteCount > 0
          ? 'Website'
          : null,
    autopilotEnabled: c.autopilotEnabled,
    publishedCount: c.publishedCount,
    scheduledCount: c.scheduledCount,
  };
}

async function loadWorkspaceFacts(userId: string, workspaceId: string): Promise<WorkspaceFacts | null> {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId },
    select: {
      id: true,
      brandSummary: true,
      audienceInsights: true,
      competitors: { select: { userDecision: true } },
    },
  });
  if (!ws) return null;

  const [connections, siteCount, enabledPolicies, storylines, publishedCount, scheduledCount] = await Promise.all([
    prisma.socialConnection.findMany({
      where: { workspaceId, status: 'CONNECTED', isDefault: true },
      select: { platform: true },
    }),
    prisma.siteConnection.count({ where: { workspaceId, status: 'ACTIVE' } }),
    prisma.autopilotPolicy.count({ where: { workspaceId, enabled: true } }),
    prisma.storyline.count({ where: { narrative: { workspaceId } } }),
    prisma.contentItem.count({ where: { workspaceId, status: 'PUBLISHED' } }),
    prisma.contentItem.count({ where: { workspaceId, status: 'SCHEDULED' } }),
  ]);

  return workspaceFactsFrom(ws as WorkspaceRow, {
    connections,
    siteCount,
    autopilotEnabled: enabledPolicies > 0,
    storylines,
    publishedCount,
    scheduledCount,
  });
}

/** Surfaces that can show `?tab=first-post`, where the live link outlives guided mode. */
const WORKSPACE_SURFACES: readonly NextStepSurface[] = ['workspace', 'connected'];

export async function loadNextStepInput(
  userId: string,
  workspaceId: string | null,
  surface: NextStepSurface,
): Promise<NextStepLoad | null> {
  if (readKillSwitch()) return null;

  const [guided, facts] = await Promise.all([
    loadGuidedMode(userId),
    workspaceId ? loadWorkspaceFacts(userId, workspaceId) : Promise.resolve(null),
  ]);

  let firstPost: FirstPostLoad | null = null;
  if (facts && (guided || WORKSPACE_SURFACES.includes(surface))) {
    if (guided) {
      // The bar is the guided user's only way forward: a wrong step is worse than an error page.
      firstPost = await loadFirstPostState(userId, facts.workspaceId);
    } else {
      // Open mode only needs it for the "live" line; a read error must not cost a publishing user the page.
      try {
        firstPost = await loadFirstPostState(userId, facts.workspaceId);
      } catch (error) {
        console.error('loadNextStepInput: first-post state failed (open mode, ignored):', error);
      }
    }
  }

  return {
    input: { guided, facts, firstPost: firstPost?.state ?? null, surface },
    firstPost,
  };
}
