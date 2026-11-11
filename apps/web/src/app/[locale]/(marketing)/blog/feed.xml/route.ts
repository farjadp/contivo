/**
 * GET /{locale}/blog/feed.xml — RSS 2.0 for one language's posts.
 * Cached like the pages it lists and cleared by the same revalidate ping.
 */

import { getTranslations } from 'next-intl/server';

import { BLOG_REVALIDATE_SECONDS, fetchPostsForLocale } from '@/lib/blog/api';
import { buildRss, isBlogLocale } from '@/lib/blog/metadata';

export const revalidate = 600;

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'fa' }];
}

export async function GET(_request: Request, context: { params: Promise<{ locale: string }> }) {
  const { locale } = await context.params;
  if (!isBlogLocale(locale)) return new Response('Not found', { status: 404 });

  const [t, posts] = await Promise.all([
    getTranslations({ locale, namespace: 'blog.meta' }),
    fetchPostsForLocale(locale),
  ]);

  return new Response(buildRss(locale, posts, { title: t('feedTitle'), description: t('description') }), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, max-age=0, s-maxage=${BLOG_REVALIDATE_SECONDS}, stale-while-revalidate`,
    },
  });
}
