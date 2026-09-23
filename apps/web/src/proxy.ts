import createMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';

/**
 * The app authenticates with its own signed session cookie (see lib/auth.ts).
 * Clerk's middleware used to run here too, and with stale test keys it logged
 * "Refreshing the session token resulted in an infinite redirect loop" on
 * every single request. It authenticated nothing — route protection lives in
 * the (dashboard) and (onboarding) layouts — so it is gone.
 *
 * What runs here now is locale negotiation only: it reads the NEXT_LOCALE
 * cookie, falls back to Accept-Language, and redirects a bare path onto its
 * /en or /fa twin. Auth stays in the layouts, where it can read the database.
 */
export default createMiddleware(routing);

export const config = {
  matcher: [
    /*
      Everything except the API routes, Next internals and static files. The
      API is excluded deliberately: `/api/v1/posts` is a public contract that
      customers' sites call, and prefixing it with a locale would break every
      integration already in the wild.
    */
    '/((?!api|_next|_vercel|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
