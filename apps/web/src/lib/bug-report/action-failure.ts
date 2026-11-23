/**
 * Server-side failure recording: one call turns a failed server action into a
 * reference (CTV-7F3K) that is written to activity_logs, tagged on the Sentry
 * event, logged, and handed to the browser in a short-lived cookie.
 *
 * Server only (next/headers, Sentry, prisma). Nothing here ever throws, and no
 * upstream message text is logged or stored: only the ref, the action name and
 * the closed CauseCode.
 */

import * as Sentry from '@sentry/nextjs';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import { actionError } from '@/lib/action-errors';
import { writeActivityLog } from '@/lib/activity-log';
import { getSession } from '@/lib/auth';

import { classifyCause } from './cause';
import { generateRef } from './ref';
import { REF_COOKIE, type ActionFailure, type CauseCode } from './types';

export type RecordActionFailureArgs = {
  action: string;
  error: unknown;
  workspaceId?: string | null;
  userId?: string | null;
  /** Skip classification: the caller already knows the cause (a returned, not thrown, failure). */
  code?: CauseCode;
};

export async function recordActionFailure(args: RecordActionFailureArgs): Promise<{ ref: string; code: CauseCode }> {
  let ref = 'CTV-XXXX';
  let code: CauseCode = 'UNKNOWN';
  try {
    ref = generateRef();
  } catch {
    // generateRef only fails without Web Crypto; keep the placeholder shape rather than throw.
    ref = 'CTV-2222';
  }
  try {
    code = args.code ?? classifyCause(args.error);
  } catch {
    code = 'UNKNOWN';
  }
  const action = args.action;

  console.error(`[${ref}] ${action} ${code}`);

  let sentryEventId: string | undefined;
  try {
    const eventId = Sentry.captureException(args.error ?? new Error(`${action}:${code}`), {
      tags: { ref, code, action },
    });
    if (typeof eventId === 'string' && eventId) sentryEventId = eventId;
  } catch {
    // Sentry unavailable: the ref and log line above still exist.
  }

  try {
    let userId = args.userId ?? null;
    if (!userId) {
      try {
        userId = (await getSession())?.userId ?? null;
      } catch {
        userId = null;
      }
    }
    if (userId) {
      await writeActivityLog({
        userId,
        action: 'ACTION_FAILED',
        workspaceId: args.workspaceId ?? null,
        detail: { ref, action, code, ...(sentryEventId ? { sentryEventId } : {}) },
      });
    }
  } catch {
    // writeActivityLog already swallows its own errors; this guards the rest.
  }

  try {
    const store = await cookies();
    store.set(REF_COOKIE, ref, { path: '/', maxAge: 600, sameSite: 'lax', httpOnly: false });
  } catch {
    // cookies() throws outside a request (cron, tests): fine.
  }

  return { ref, code };
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND'));
}

export type GuardedActionOptions = {
  /**
   * For a RETURNED { error } (not thrown): the cause to record. Without it a
   * returned failure is passed through untouched; with it a ref is attached.
   */
  code?: CauseCode;
};

/**
 * Wraps a server action body. A thrown error is recorded and becomes
 * { error: <friendly text>, ref }. A returned { error } passes through
 * unchanged, gaining a ref only when the caller supplies `options.code`.
 * redirect()/notFound() keep working: they are rethrown.
 */
export async function guardedAction<T extends object>(
  action: string,
  workspaceId: string | null,
  fn: () => Promise<T | ActionFailure>,
  friendlyKey?: string,
  options?: GuardedActionOptions,
): Promise<T | ActionFailure> {
  try {
    const result = await fn();
    const failure = result as Partial<ActionFailure> | null;
    if (options?.code && failure && typeof failure.error === 'string' && !failure.ref) {
      const { ref } = await recordActionFailure({ action, error: null, workspaceId, code: options.code });
      return { ...(result as object), ref } as T | ActionFailure;
    }
    return result;
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    unstable_rethrow(error);

    const { ref } = await recordActionFailure({ action, error, workspaceId });
    let message = 'Something went wrong. Please try again.';
    try {
      message = await actionError(friendlyKey ?? 'generic');
    } catch {
      // No request locale available: keep the English fallback.
    }
    return { error: message, ref };
  }
}
