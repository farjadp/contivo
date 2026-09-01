import { NextResponse } from 'next/server';

/**
 * The app authenticates with its own signed session cookie (see lib/auth.ts).
 * Clerk's middleware used to run here too, and with stale test keys it logged
 * "Refreshing the session token resulted in an infinite redirect loop" on
 * every single request. It authenticated nothing — route protection lives in
 * the (dashboard) and (onboarding) layouts — so it is gone.
 */
export default function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
