import type { MetadataRoute } from 'next';

import { LEGAL_UPDATED } from '@/components/marketing/legal-document';
import { locales } from '@/i18n/routing';

/**
 * The public pages, each listed once per language with its twin declared as
 * an alternate. Signed-in screens are left out on purpose: they redirect a
 * crawler to sign-in, and listing them only teaches Google about redirects.
 */
const PAGES: ReadonlyArray<{ path: string; priority: number; modified?: Date }> = [
  { path: '', priority: 1 },
  { path: '/pricing', priority: 0.8 },
  { path: '/about', priority: 0.6 },
  { path: '/contact', priority: 0.5 },
  { path: '/docs/site-api', priority: 0.4 },
  { path: '/privacy', priority: 0.3, modified: LEGAL_UPDATED.privacy },
  { path: '/terms', priority: 0.3, modified: LEGAL_UPDATED.terms },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.contivo.app').replace(/\/$/, '');
  const url = (locale: string, path: string) => `${base}/${locale}${path}`;

  return PAGES.flatMap(({ path, priority, modified }) =>
    locales.map((locale) => ({
      url: url(locale, path),
      lastModified: modified,
      priority,
      alternates: {
        languages: Object.fromEntries(locales.map((l) => [l, url(l, path)])),
      },
    })),
  );
}
