'use server';

/**
 * Credits, from the customer's side.
 *
 * Buying credits is not possible yet, so the one thing a customer can do when
 * the balance runs low is ask: this records a CREDITS_REQUESTED row the admin
 * list reads (lib/credit-requests.ts), and the team tops the account up by
 * hand through the admin console's adjustCredits.
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { recordActivityOncePerWindow } from '@/lib/activity-log';
import { getCreditBalance } from '@/lib/credits';
import { CREDITS_REQUESTED_ACTION, CREDIT_REQUEST_WINDOW_HOURS } from '@/lib/credit-requests';
import { actionError } from '@/lib/action-errors';

export type RequestCreditsResult =
  | { status: 'requested' }
  | { status: 'already_requested'; requestedAt: string }
  | { error: string };

export async function requestMoreCredits(workspaceId: string): Promise<RequestCreditsResult> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  const userId = session.userId as string;

  if (typeof workspaceId !== 'string' || !workspaceId) {
    return { error: await actionError('workspaceNotFoundDot') };
  }
  // Same ownership check as every other workspace action: id AND owner.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, userId },
    select: { id: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFoundDot') };

  try {
    const balance = await getCreditBalance(userId);
    const result = await recordActivityOncePerWindow({
      userId,
      workspaceId,
      action: CREDITS_REQUESTED_ACTION,
      detail: { workspaceId, balance },
      windowHours: CREDIT_REQUEST_WINDOW_HOURS,
    });
    if (!result.recorded) {
      return { status: 'already_requested', requestedAt: result.lastAt.toISOString() };
    }
    return { status: 'requested' };
  } catch (error) {
    console.error('requestMoreCredits failed:', error);
    return { error: await actionError('creditRequestFailed') };
  }
}
