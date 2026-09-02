/**
 * Server and edge startup hook. Next calls register() once per runtime.
 *
 * onRequestError is what turns a failed server render or server action into a
 * reported error; without it those are the ones that vanish quietest.
 */

import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry-options';

export async function register() {
  Sentry.init(sentryOptions);
}

export const onRequestError = Sentry.captureRequestError;
