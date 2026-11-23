'use server';

import { Prisma } from '@prisma/client';
import { after } from 'next/server';

import { actionError } from '@/lib/action-errors';
import { writeActivityLog } from '@/lib/activity-log';
import { getSession } from '@/lib/auth';
import { buildServerContext } from '@/lib/bug-report/context';
import { computeFingerprint } from '@/lib/bug-report/fingerprint';
import { redactText } from '@/lib/bug-report/redact';
import { generateRef, isRef } from '@/lib/bug-report/ref';
import { MESSAGE_MAX, type SubmitBugReportInput, type SubmitBugReportResult } from '@/lib/bug-report/types';
import { prisma } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const REPORTS_PER_HOUR = 10;
const MAX_REF_TRIES = 5;

/** Runs after the response is sent; outside a request scope it is simply fire-and-forget. */
function afterResponse(task: () => Promise<unknown>): void {
  const run = () => Promise.resolve().then(task).catch((error) => console.error('submitBugReport: deferred task failed:', error instanceof Error ? error.name : 'error'));
  try {
    after(run);
  } catch {
    void run();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export async function submitBugReport(input: SubmitBugReportInput): Promise<SubmitBugReportResult> {
  try {
    const session = await getSession();
    if (!session?.userId) return { ok: false, error: await actionError('notAuthenticated') };
    const userId = session.userId as string;

    const limit = await consumeRateLimit(`bugreport:${userId}`, REPORTS_PER_HOUR, 60 * 60 * 1000);
    if (!limit.allowed) return { ok: false, error: await actionError('bugReportRateLimited') };

    const raw = input && typeof input === 'object' ? input : ({} as SubmitBugReportInput);
    const text = typeof raw.message === 'string' ? redactText(raw.message, MESSAGE_MAX) : '';
    const message = text || null;
    const claimedRef = isRef(raw.ref) ? raw.ref : null;

    const built = await buildServerContext({ userId, ref: claimedRef, client: raw.client });
    const { context } = built;
    const route = context.client.route || null;
    const fingerprint = computeFingerprint({
      causeCode: built.causeCode,
      failedAction: built.failedAction,
      route,
    });

    // Reuse the user's own failure ref so the report and the failure log share one key.
    // If a report already took it (unique violation), a fresh ref is generated.
    let candidate = context.ref ?? generateRef();
    for (let attempt = 0; attempt < MAX_REF_TRIES; attempt++) {
      try {
        await prisma.bugReport.create({
          data: {
            referenceCode: candidate,
            userId,
            workspaceId: context.workspaceId,
            message,
            locale: context.client.locale || null,
            route,
            appVersion: context.appVersion,
            context: context as unknown as Prisma.InputJsonValue,
            fingerprint,
          },
        });
        // The report is saved; this audit row is not worth the user's wait.
        const sentRef = candidate;
        afterResponse(() =>
          writeActivityLog({ userId, workspaceId: context.workspaceId, action: 'BUG_REPORT_SENT', detail: { ref: sentRef } }),
        );
        return { ok: true, ref: candidate };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        candidate = generateRef();
      }
    }
    console.error('submitBugReport: no free reference code after retries');
    return { ok: false, error: await actionError('bugReportFailed') };
  } catch (error) {
    console.error('submitBugReport failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, error: await actionError('bugReportFailed') };
  }
}
