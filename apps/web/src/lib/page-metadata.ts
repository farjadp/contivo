import { routing } from '@/i18n/routing';

/**
 * hreflang and canonical for one public page.
 *
 * The root layout declares alternates for `/en` and `/fa` only. A child page
 * that does not override them inherits those, which tells Google that the
 * Persian version of /en/privacy is the Persian *homepage*. Every public page
 * passes its own path through here instead.
 *
 * `path` is the locale-less route: '' for the home page, '/privacy' otherwise.
 */
export function pageAlternates(locale: string, path: string) {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      en: `/en${path}`,
      fa: `/fa${path}`,
      'x-default': `/${routing.defaultLocale}${path}`,
    },
  };
}
