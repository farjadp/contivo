'use server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { actionError } from '@/lib/action-errors';
import { runManualGate, type StoredVerdict } from '@/lib/quality-verdict';

/**
 * "Check again" on a Pipeline card (B8): one gate call on the item's current
 * text, run only because the user asked. Used after an edit reset the verdict
 * to "not checked", or after the judge was unavailable. Only AI drafts that
 * already carry a verdict can be rechecked; "Write a post" items stay ungated.
 */
export async function recheckContentQuality(
  contentId: string,
): Promise<{ verdict: StoredVerdict } | { error: string }> {
  const session = await getSession();
  if (!session?.userId) return { error: await actionError('notAuthenticated') };
  const userId = session.userId as string;

  const item = await prisma.contentItem.findFirst({
    where: { id: contentId, userId },
    select: {
      id: true,
      workspaceId: true,
      topic: true,
      channel: true,
      content: true,
      storylineId: true,
      qualityVerdict: true,
      workspace: { select: { brandSummary: true, contentLanguage: true } },
    },
  });
  if (!item || !item.workspaceId || !item.workspace) return { error: 'Content item not found' };
  if (item.qualityVerdict === null) return { error: 'This post is not quality-checked.' };

  const verdict = await runManualGate({
    actor: { userId, workspaceId: item.workspaceId },
    workspace: item.workspace,
    content: String(item.content || '').trim(),
    topic: item.topic,
    channel: item.channel,
    storylineId: item.storylineId,
    excludeItemId: item.id,
    source: 'recheck',
  });

  await prisma.contentItem.update({
    where: { id: item.id, userId },
    data: { qualityVerdict: verdict as unknown as object },
  });
  return { verdict };
}
