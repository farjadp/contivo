'use server';

import { getSession } from '@/lib/auth';
import {
  generateDraftForItem,
  generateDraftPreviewCore,
  ideateForWorkspace,
  saveIdeaToPipelineCore,
  type ManualSourcePayload,
} from '@/lib/content-engine';
import type { IdeationRequestOptions } from '@/lib/gemini';

// The content workflow logic lives in `@/lib/content-engine` so that the
// Autopilot runner can call it without a session. These actions only
// resolve the session and delegate; return shapes are unchanged.

export async function generateIdeas(workspaceId: string, options?: IdeationRequestOptions) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  return ideateForWorkspace({ userId: session.userId as string, workspaceId }, options);
}

export async function saveIdeaToPipeline(workspaceId: string, idea: any) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  return saveIdeaToPipelineCore({ userId: session.userId as string, workspaceId }, idea);
}

export async function generateDraftPreviewFromIdea(
  workspaceId: string,
  idea: any,
  manualSource?: ManualSourcePayload,
) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  return generateDraftPreviewCore(
    { userId: session.userId as string, workspaceId },
    idea,
    manualSource,
  );
}

export async function generatePostFromPipeline(
  workspaceId: string,
  itemId: string,
  manualSource?: ManualSourcePayload,
) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  return generateDraftForItem({ userId: session.userId as string, workspaceId }, itemId, {
    manualSource,
  });
}
