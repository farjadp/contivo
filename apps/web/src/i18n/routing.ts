import { defineRouting } from 'next-intl/routing';

/**
 * The two languages Contivo ships in.
 *
 * `fa` is not a translation bolted onto an English product: it carries its own
 * direction, its own font stack and its own AI prompt language, so a Persian
 * workspace produces Persian articles rather than English ones with a Persian
 * menu around them. Anything added here has to answer all three questions.
 */
export const locales = ['en', 'fa'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Right-to-left locales. Drives `dir`, the font stack and logical-CSS mirroring. */
const RTL_LOCALES = new Set<Locale>(['fa']);

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale as Locale);
}

export function dirFor(locale: string): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  /*
    Every locale carries its prefix, including the default. A Persian page that
    lives at the same URL as its English twin cannot be indexed, shared or
    linked as Persian — and the whole point of /fa is that it is a real,
    separately addressable version of the product.
  */
  localePrefix: 'always',
  /*
    Browser negotiation decides the first visit; the cookie next-intl writes on
    a manual switch outranks it afterwards, so choosing English once is not
    undone by a Persian Accept-Language header on the next request.
  */
  localeDetection: true,
  /*
    Declaring every route here is what keeps `typedRoutes` working after the
    move under [locale]: Next now types its routes as `/[locale]/pricing`,
    while the app links to `/pricing` and lets the locale be applied for it.
    Without this map the two disagree and the only way out is switching typed
    routes off, which trades a real compile-time guarantee for a translation.

    Each entry may also carry a per-locale slug — `'/pricing': { en: '/pricing',
    fa: '/قیمت‌گذاری' }` — if the Persian side ever wants its own URLs. The slugs
    are identical for now so that a link copied from one language still opens
    in the other, and so that existing bookmarks survive the locale move.
  */
  pathnames: {
    '/': '/',
    '/pricing': '/pricing',
    '/docs/site-api': '/docs/site-api',
    '/sign-in': '/sign-in',
    '/sign-up': '/sign-up',
    '/onboarding': '/onboarding',
    '/dashboard': '/dashboard',
    '/instant': '/instant',
    '/settings': '/settings',
    '/connections': '/connections',
    '/growth': '/growth',
    '/growth/new': '/growth/new',
    '/growth/analyzing': '/growth/analyzing',
    '/growth/competitors': '/growth/competitors',
    '/growth/review': '/growth/review',
    '/growth/[id]': '/growth/[id]',
    '/admin': '/admin',
    '/admin/content/[contentId]': '/admin/content/[contentId]',
    '/admin/users/[userId]': '/admin/users/[userId]',
    '/admin/workspaces/[workspaceId]': '/admin/workspaces/[workspaceId]',
  },
});
