import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';

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
  'workspace',
  'admin',
  'errors',
] as const;

async function loadMessages(locale: string) {
  const files = await Promise.all(
    NAMESPACES.map(async (ns) => (await import(`../../messages/${locale}/${ns}.json`)).default),
  );
  return Object.assign({}, ...files);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    /*
      Tehran time and the Persian calendar, so a schedule a Persian user sets
      reads back in the calendar they actually use. Dates formatted through
      next-intl's `useFormatter` pick this up without per-call arguments.
    */
    timeZone: locale === 'fa' ? 'Asia/Tehran' : 'UTC',
    now: new Date(),
  };
});
