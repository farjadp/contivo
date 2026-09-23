export { default } from './proxy';

/**
 * The matcher is declared here, as a literal, and cannot be moved.
 *
 * Next reads `config` by statically analysing this file at build time. It does
 * not follow a re-export: `export { config } from './proxy'` type-checks, runs,
 * and is silently ignored — Next falls back to running the middleware on every
 * request. That was harmless for years because the middleware only called
 * `NextResponse.next()`. The moment it began redirecting for locale, every
 * stylesheet, script chunk, font and API call was answered with a 307 into
 * /en, and both languages rendered as unstyled HTML with a dead API.
 *
 * Excluded: the API (/api/v1/posts is a contract customers' sites already call,
 * and a locale prefix would break every live integration), Next's own
 * internals, and any path carrying a file extension.
 */
export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
