import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { cookies } from 'next/headers';

import { TIMEZONE_COOKIE } from '@/lib/timezone-cookie';
import { routing } from './routing';

/**
 * One file per area of the product rather than one file per language.
 *
 * A single messages/fa.json would be a few thousand lines that every piece of
 * work on the app has to edit, which makes it the file two branches always
 * collide on. Split this way, a change to the admin console's wording never
 * touches the file the marketing page reads from.
 *
 * Adding an area means adding it here and creating messages/<locale>/<area>.json
 * for BOTH locales — a namespace present in one language and missing in the
 * other throws at request time rather than falling back silently, which is the
 * behaviour we want: a missing translation should be loud.
 */
const NAMESPACES = [
  'marketing',
  'pricing',
  'auth',
  'onboarding',
  'shell',
  'dashboard',
  'instant',
  'settings',
  'connections',
  'growth',
  'tabs-b',
  'workspace',
  'tabs-a',
  'admin',
  'errors',
] as const;

/**
 * Narrows the cookie to something `Intl` will accept, so a junk value cannot throw.
 *
 * Reading a cookie here opts every page into dynamic rendering, including the
 * three marketing pages that have no timestamps on them. That is a real cost
 * and it is taken deliberately: the rest of the product is authenticated and
 * reads a session cookie anyway, so it was already dynamic, and a timestamp
 * silently four hours wrong is a correctness bug where a dynamically rendered
 * landing page is a performance choice. If the landing page's render time ever
 * matters more, the fix is to move the zone out of here and onto the subtree
 * that actually formats dates, not to go back to guessing UTC.
 */
function resolveTimeZone(store: Awaited<ReturnType<typeof cookies>>, locale: string): string {
  const fallback = locale === 'fa' ? 'Asia/Tehran' : 'UTC';
  const raw = store.get(TIMEZONE_COOKIE)?.value;
  if (!raw) return fallback;
  try {
    /*
      Decoded first. The probe percent-encodes the value, so the slash in
      "America/Toronto" arrives as %2F — which is not a zone name, fails the
      check below, and falls back to UTC. That produced exactly the bug this
      function exists to prevent: a correct cookie, a silent fallback, and
      timestamps four hours wrong with nothing in the logs.
    */
    const reported = decodeURIComponent(raw);
    // Throws on an unknown zone, which is the only validation worth doing here.
    new Intl.DateTimeFormat('en-US', { timeZone: reported });
    return reported;
  } catch {
    return fallback;
  }
}

async function loadMessages(locale: string) {
  const files = await Promise.all(
    NAMESPACES.map(async (ns) => (await import(`../../messages/${locale}/${ns}.json`)).default),
  );
  return Object.assign({}, ...files);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const cookieStore = await cookies();

  return {
    locale,
    messages: await loadMessages(locale),
    /*
      The reader's own timezone, reported by `TimezoneProbe` on their first
      visit. Formatting moved to the server when the app was translated, and
      the server has to be told a zone or the markup it renders will not match
      what the browser would have produced.

      The fallback only applies to the first render of a new session: Tehran
      for Persian, because it is the overwhelmingly likely answer and far
      better than UTC for that reader, and UTC for English, where there is no
      likely answer to guess at.

      Persian also gets the Jalali calendar from the locale itself, so a
      schedule set in Mehr reads back in Mehr.
    */
    timeZone: resolveTimeZone(cookieStore, locale),
    now: new Date(),
  };
});
