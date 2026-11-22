/**
 * web-return.ts
 *
 * Builds the web app URL an OAuth connect returns to (B18).
 *
 * The web app prefixes every route with its locale (`localePrefix: 'always'`),
 * and a bare /connections is sent to /en. A customer who connected from
 * /fa/connections came back in English. The locale they started in travels
 * in the signed handoff and a short-lived cookie, and is put back here.
 *
 * Only app locales are accepted: the value ends up in a redirect, so anything
 * else is dropped rather than echoed.
 */

/** Locales the signed-in app runs in. Must match apps/web/src/i18n/routing.ts (locales minus SITE_ONLY_LOCALES). */
export const APP_LOCALES = ['en', 'fa', 'it', 'es', 'he'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** Holds the starting locale between /connect and /callback, beside the nonce cookie. */
export const OAUTH_LOCALE_COOKIE = 'contivo_oauth_locale';

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}

const webUrl = () => process.env.WEB_APP_URL ?? 'http://localhost:3000';

/** `<web>/<locale>/connections?<query>`, or without the locale when it is unknown. */
export function connectionsUrl(query: Record<string, string>, locale?: string | null): string {
  const prefix = isAppLocale(locale) ? `/${locale}` : '';
  const qs = new URLSearchParams(query).toString();
  return `${webUrl()}${prefix}/connections${qs ? `?${qs}` : ''}`;
}
