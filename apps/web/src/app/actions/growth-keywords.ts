'use server';

import { getSession } from '@/lib/auth';
import { actionError } from '@/lib/action-errors';
import { generateCompetitorKeywordsCore } from '@/lib/competitor-keywords/generate';

export type {
  CompetitorKeywordIntel,
  CompetitorKeywordsPayload,
  ContentGapOpportunity,
  KeywordHeatmapRow,
} from '@/lib/competitor-keywords/generate';

export async function generateWorkspaceCompetitorKeywords(workspaceId: string) {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId) return { error: await actionError('workspaceIdRequired') };

  const result = await generateCompetitorKeywordsCore({ userId: session.userId as string, workspaceId });
  if (!result.ok) return { error: await actionError(result.errorKey) };
  return { success: true, payload: result.payload };
}
