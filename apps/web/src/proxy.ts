import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { APP_SEGMENTS, isSiteOnly, routing } from '@/i18n/routing';

/*
  The route matcher for this middleware lives in `middleware.ts`, not here —
  Next only reads a `config` export it can see statically in the middleware
  file itself, and will not follow it through a re-export.
*/

/**
 * The app authenticates with its own signed session cookie (see lib/auth.ts).
 * Clerk's middleware used to run here too, and with stale test keys it logged
 * "Refreshing the session token resulted in an infinite redirect loop" on
 * every single request. It authenticated nothing — route protection lives in
 * the (dashboard) and (onboarding) layouts — so it is gone.
 *
 * What runs here now is locale routing only: detection is off (see
 * routing.ts), so a bare path is redirected onto its /en twin and a prefixed
 * one is served as is. Auth stays in the layouts, where it can read the database.
 */
const intl = createMiddleware(routing);

/**
 * Site-only locales (fr, ar, zh) have a translated public site but no
 * translated app, so their signed-in routes go to the English app rather than
 * rendering English strings in a right-to-left or Chinese shell.
 */
export default function proxy(request: NextRequest) {
  const [, locale, segment] = request.nextUrl.pathname.split('/');
  if (locale && segment && isSiteOnly(locale) && APP_SEGMENTS.has(segment)) {
    const url = request.nextUrl.clone();
    url.pathname = `/en${request.nextUrl.pathname.slice(locale.length + 1)}`;
    return NextResponse.redirect(url);
  }
  return intl(request);
}
