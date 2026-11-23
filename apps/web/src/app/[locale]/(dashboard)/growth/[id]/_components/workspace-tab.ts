/**
 * The workspace page's tab rules and first-post wiring, kept out of page.tsx
 * so they can be tested (spec first-post B D2, §7, finding E of T1).
 */

import { writeActivityLog } from '@/lib/activity-log';
import { prisma } from '@/lib/db';
import { competitorOrigin } from '@/lib/competitors/selection';
import type { EvidenceItem } from '@/lib/competitors/types';
import { FIRST_DRAFT_SEEN, type FirstPostCompetitor } from '@/lib/first-post/types';

const BASE_TABS = new Set([
  'pipeline',
  'ideation',
  'strategy',
  'progress',
  'matrices',
  'keywords',
  'offerings',
  'narrative',
  'calendar',
  'seo',
  'reports',
  'autopilot',
]);

export type TabContext = {
  /** Guided mode (false under the kill switch). */
  guided: boolean;
  /** The first-post state is `published`: its card must survive a reload after guided mode ends. */
  firstPostPublished: boolean;
  /** `?from=analyzing`: the analysis just finished and named no tab. */
  fromAnalyzing: boolean;
};

export function resolveWorkspaceTab(rawTab: string | string[] | undefined, ctx: TabContext): string {
  const value = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const firstPostAllowed = ctx.guided || ctx.firstPostPublished;
  if (value && (BASE_TABS.has(value) || (value === 'first-post' && firstPostAllowed))) return value;
  if (ctx.guided) return 'first-post';
  // Open mode right after the analysis: the brand memory it just built, as before.
  if (ctx.fromAnalyzing) return 'strategy';
  return 'pipeline';
}

type CompetitorRow = {
  id: string;
  name: string;
  domain: string | null;
  userDecision: string | null;
  evidence: unknown;
  source: string | null;
  discoveryRunId: string | null;
};

/** The rows the confirm step can tick: everything not rejected, in stored order. */
export function toFirstPostCompetitors(rows: CompetitorRow[]): FirstPostCompetitor[] {
  return rows
    .filter((c) => c.userDecision !== 'REJECTED')
    .map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      userDecision: c.userDecision,
      evidence: Array.isArray(c.evidence) ? (c.evidence as EvidenceItem[]) : [],
      source: competitorOrigin(c),
    }));
}

/**
 * FIRST_DRAFT_SEEN, once per workspace (spec §7): ids and the verdict only.
 * Never throws; the page does not await it. Two renders in the same instant
 * could both write; the funnel query counts workspaces, so a duplicate row
 * does not change the number.
 */
export async function recordFirstDraftSeen(
  userId: string,
  workspaceId: string,
  draft: { contentItemId: string; approved: boolean },
): Promise<void> {
  try {
    const existing = await prisma.activity_logs.findFirst({
      where: { workspace_id: workspaceId, action: FIRST_DRAFT_SEEN },
      select: { id: true },
    });
    if (existing) return;
    await writeActivityLog({
      userId,
      workspaceId,
      action: FIRST_DRAFT_SEEN,
      detail: { contentItemId: draft.contentItemId, approved: draft.approved },
    });
  } catch (error) {
    console.error('recordFirstDraftSeen failed:', error);
  }
}
