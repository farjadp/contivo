/**
 * Sentry for the API. Imported first in main.ts, before Nest is created,
 * because the SDK has to patch the runtime before anything else touches it.
 *
 * Keyed on a real DSN: without one the SDK is never initialised, so a deploy
 * that has not been given a DSN behaves exactly as it did before. The
 * placeholder that has sat in every env file for months does not count as one.
 */

import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim();
const looksReal = Boolean(dsn && !/x{4,}/i.test(dsn) && dsn.startsWith('http'));

if (looksReal) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    // Errors only. Traces are volume, and volume crowds out the errors this
    // exists to surface.
    tracesSampleRate: 0,
    // Never ship request bodies or headers: this service handles OAuth
    // callbacks and social tokens.
    sendDefaultPii: false,
  });
}

export const sentryEnabled = looksReal;
