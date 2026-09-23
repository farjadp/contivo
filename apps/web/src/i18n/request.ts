import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';

import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    /*
      Tehran time and the Persian calendar, so a schedule a Persian user sets
      reads back in the calendar they actually use. Dates formatted through
      next-intl's `useFormatter` pick this up without per-call arguments.
    */
    timeZone: locale === 'fa' ? 'Asia/Tehran' : 'UTC',
    now: new Date(),
  };
});
