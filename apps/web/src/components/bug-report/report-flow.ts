/**
 * The send step of the report sheet, without React: easy to test, and the one
 * place that turns a thrown error into a friendly view.
 */
import type { ClientContext, SubmitBugReportInput, SubmitBugReportResult } from '@/lib/bug-report/types';

export type SendOutcome = { phase: 'sent'; ref: string } | { phase: 'error'; error: string };

export async function sendReport(
  submit: (input: SubmitBugReportInput) => Promise<SubmitBugReportResult>,
  args: { message: string; ref: string | null; client: ClientContext; fallbackError: string },
): Promise<SendOutcome> {
  const message = args.message.trim();
  try {
    const result = await submit({
      ...(message ? { message } : {}),
      ...(args.ref ? { ref: args.ref } : {}),
      client: args.client,
    });
    if (result.ok) return { phase: 'sent', ref: result.ref };
    return { phase: 'error', error: result.error || args.fallbackError };
  } catch {
    return { phase: 'error', error: args.fallbackError };
  }
}
