/**
 * Server and edge startup hook. Next calls register() once per runtime.
 *
 * onRequestError is what turns a failed server render or server action into a
 * reported error; without it those are the ones that vanish quietest.
 */

import * as Sentry from '@sentry/nextjs';

import { refFromDigest } from '@/lib/bug-report/ref';
import { sentryOptions } from '@/lib/sentry-options';

export async function register() {
  Sentry.init(sentryOptions);
}

type OnRequestError = typeof Sentry.captureRequestError;

/**
 * Production render errors reach the browser only as a digest. The browser
 * derives the same ref from that digest (refFromDigest), so the code a user
 * reads off the error page finds this log line and this Sentry tag.
 */
export const onRequestError: OnRequestError = (err, request, context) => {
  try {
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === 'string' && digest) {
      const ref = refFromDigest(digest);
      Sentry.getCurrentScope().setTag('ref', ref);
      console.error(`[${ref}] render/action error digest=${digest}`);
    }
  } catch {
    // Reporting must not fail because tagging did.
  }
  return Sentry.captureRequestError(err, request, context);
};
