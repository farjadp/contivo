import { defineRouting } from 'next-intl/routing';

/**
 * The languages Contivo ships in.
 *
 * `fa` is not a translation bolted onto an English product: it carries its own
 * direction, its own font stack and its own AI prompt language, so a Persian
 * workspace produces Persian articles rather than English ones with a Persian
 * menu around them. Anything added here has to answer all three questions.
 *
 * `it` and `es` are left-to-right and covered by the Latin font stack. `he` is
 * right-to-left and takes its glyphs from IBM Plex Sans Hebrew, the Hebrew
 * cut of the face the marketing site already uses. All three write in English:
 * the content language (see lib/content-language.ts) is a Prisma enum with EN
 * and FA only, so they are UI languages for now.
 *
 * `fr`, `ar` and `zh` are SITE-ONLY locales (22 Nov 2026): the public site and
 * sign-up/sign-in are translated, the signed-in app is not, and proxy.ts sends
 * their app routes to the English app. Every page in them says content is
 * written in English or Persian.
 */
export const locales = ['en', 'fa', 'it', 'es', 'he', 'fr', 'ar', 'zh'] as const;
export type Locale = (typeof locales)[number];

/** Locales whose signed-in app is not translated. See proxy.ts and request.ts. */
export const SITE_ONLY_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['fr', 'ar', 'zh']);

export function isSiteOnly(locale: string): boolean {
  return SITE_ONLY_LOCALES.has(locale as Locale);
}

/**
 * Message namespaces the public site, sign-up and sign-in read. A site-only
 * locale ships these; every other namespace is loaded from English.
 */
export const SITE_NAMESPACES: ReadonlySet<string> = new Set([
  'marketing',
  'pricing',
  'legal',
  'company',
  'features',
  'compare',
  'why',
  'product',
  'roadmap',
  'team',
  'blog',
  'auth',
  'shell',
  'errors',
]);

/**
 * First path segment of every signed-in route. A site-only locale on one of
 * these is redirected to the English app.
 */
export const APP_SEGMENTS: ReadonlySet<string> = new Set([
  'dashboard',
  'onboarding',
  'growth',
  'connections',
  'instant',
  'settings',
  'admin',
]);

export const defaultLocale: Locale = 'en';

/** Right-to-left locales. Drives `dir`, the font stack and logical-CSS mirroring. */
const RTL_LOCALES = new Set<Locale>(['fa', 'he', 'ar']);

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
    A bare URL always opens in English. Negotiating from Accept-Language and the
    NEXT_LOCALE cookie sent visitors with a Persian or Italian browser to that
    language before they had chosen it; the switcher is how a reader picks one,
    and the locale then travels in the URL.
  */
  localeDetection: false,
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
    '/features': '/features',
    '/compare': '/compare',
    '/why': '/why',
    '/product': '/product',
    '/roadmap': '/roadmap',
    '/team': '/team',
    '/about': '/about',
    '/contact': '/contact',
    '/privacy': '/privacy',
    '/terms': '/terms',
    '/disclaimer': '/disclaimer',
    '/blog': '/blog',
    '/blog/[slug]': '/blog/[slug]',
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
    '/growth/[id]': '/growth/[id]',
    '/admin': '/admin',
    '/admin/content/[contentId]': '/admin/content/[contentId]',
    '/admin/users/[userId]': '/admin/users/[userId]',
    '/admin/workspaces/[workspaceId]': '/admin/workspaces/[workspaceId]',
  },
});
