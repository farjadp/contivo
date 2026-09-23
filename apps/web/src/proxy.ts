import createMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';

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
 * What runs here now is locale negotiation only: it reads the NEXT_LOCALE
 * cookie, falls back to Accept-Language, and redirects a bare path onto its
 * /en or /fa twin. Auth stays in the layouts, where it can read the database.
 */
export default createMiddleware(routing);
