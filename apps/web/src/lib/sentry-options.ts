/**
 * Shared Sentry setup for the web app.
 *
 * Everything is keyed on the DSN being present. Without it `enabled` is false
 * and the SDK does nothing at all — no network, no noise in local development,
 * and a deploy that has not been given a DSN behaves exactly as it did before.
 * That is deliberate: monitoring should be able to arrive later without any
 * code change, and it should never be the reason a deploy fails.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim();

/**
 * A DSN placeholder still counts as unset. The repo shipped
 * `https://xxx@sentry.io/xxxxxxxxxx` in every env file for months, which would
 * otherwise send every error at a project that does not exist and fail
 * silently — the exact failure mode this whole effort is meant to end.
 */
const looksReal = Boolean(dsn && !/x{4,}/i.test(dsn) && dsn.startsWith('http'));

export const sentryEnabled = looksReal;

export const sentryOptions = {
  dsn: looksReal ? dsn : undefined,
  enabled: looksReal,

  environment: process.env.NODE_ENV,

  /**
   * Performance tracing off by default. Errors are the thing that has been
   * invisible here; traces are volume, and volume on a free plan means the
   * errors get dropped to make room for them.
   */
  tracesSampleRate: 0,

  /**
   * Do not send the request body or cookies. This app handles session cookies
   * and API keys, and an error report is not a place for either.
   */
  sendDefaultPii: false,

  ignoreErrors: [
    // Next's own control-flow signals, which are not faults.
    'NEXT_REDIRECT',
    'NEXT_NOT_FOUND',
    // Browser noise that says nothing about this app.
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
  ],
};
