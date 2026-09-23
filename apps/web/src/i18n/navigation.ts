import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware replacements for `next/link` and `next/navigation`.
 *
 * Importing `Link` or `redirect` from Next directly drops the visitor out of
 * /fa and back into /en on the next click, silently — which is the failure
 * mode that makes half-done translations feel broken. Anything that navigates
 * inside the app imports from here instead.
 */
const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

/**
 * Annotated explicitly rather than destructured, and the annotation is the
 * whole point: TypeScript only treats a call as terminating control flow when
 * the callee carries an explicit type. Destructured straight off the object,
 * `redirect` keeps its `never` return but stops narrowing, so every
 * `if (!session) redirect(...)` guard in the app goes back to reporting
 * `session is possibly null` on the next line — a guard the compiler no longer
 * believes in. This one line is what keeps those guards meaningful.
 */
export const redirect: typeof navigation.redirect = navigation.redirect;
