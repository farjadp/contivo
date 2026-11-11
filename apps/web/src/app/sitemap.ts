import type { MetadataRoute } from 'next';

import { LEGAL_UPDATED } from '@/components/marketing/legal-document';
import { locales } from '@/i18n/routing';
import { fetchAllPosts } from '@/lib/blog/api';
import { BLOG_LOCALES } from '@/lib/blog/metadata';

// Hourly at most; the blog fetch inside refreshes every 10 minutes and at once on a publish ping.
export const revalidate = 3600;

/**
 * The public pages, each listed once per language with its twin declared as
 * an alternate. Signed-in screens are left out on purpose: they redirect a
 * crawler to sign-in, and listing them only teaches Google about redirects.
 */
const PAGES: ReadonlyArray<{ path: string; priority: number; modified?: Date }> = [
  { path: '', priority: 1 },
  { path: '/features', priority: 0.8 },
  { path: '/pricing', priority: 0.8 },
  { path: '/about', priority: 0.6 },
  { path: '/contact', priority: 0.5 },
  { path: '/docs/site-api', priority: 0.4 },
  { path: '/privacy', priority: 0.3, modified: LEGAL_UPDATED.privacy },
  { path: '/terms', priority: 0.3, modified: LEGAL_UPDATED.terms },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.contivo.app').replace(/\/$/, '');
  const url = (locale: string, path: string) => `${base}/${locale}${path}`;

  const pages = PAGES.flatMap(({ path, priority, modified }) =>
    locales.map((locale) => ({
      url: url(locale, path),
      lastModified: modified,
      priority,
      alternates: {
        languages: Object.fromEntries(locales.map((l) => [l, url(l, path)])),
      },
    })),
  );

  /*
    The blog exists in English and Persian only (/it/blog redirects to
    /en/blog), and each post exists in the one language it was written in, so
    a post declares no twin.
  */
  const posts = await fetchAllPosts();
  const newest = posts[0]?.updatedAt ? new Date(posts[0].updatedAt) : undefined;
  const blogIndexes = BLOG_LOCALES.map((locale) => ({
    url: url(locale, '/blog'),
    lastModified: newest,
    priority: 0.7,
    alternates: { languages: Object.fromEntries(BLOG_LOCALES.map((l) => [l, url(l, '/blog')])) },
  }));
  const articles = posts.map((post) => ({
    url: url(post.locale, `/blog/${encodeURIComponent(post.slug)}`),
    lastModified: new Date(post.updatedAt),
    priority: 0.6,
  }));

  return [...pages, ...blogIndexes, ...articles];
}
