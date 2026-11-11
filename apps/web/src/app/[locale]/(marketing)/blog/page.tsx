/**
 * The blog index. Posts come from Contivo's own Content API (see
 * lib/blog/api.ts), so this page is a customer of the product it sits on.
 *
 * Statically rendered, refreshed every 10 minutes or at once when the
 * publisher pings /api/blog/revalidate.
 */

import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link, redirect } from '@/i18n/navigation';
import { fetchPostsForLocale } from '@/lib/blog/api';
import { readingMinutes } from '@/lib/blog/content';
import { indexJsonLd, indexMetadata, isBlogLocale, serializeJsonLd } from '@/lib/blog/metadata';

// Literal on purpose: Next reads segment config statically and ignores an imported constant.
export const revalidate = 600;

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  if (!isBlogLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'blog.meta' });
  return indexMetadata(locale, { title: t('title'), description: t('description'), feedTitle: t('feedTitle') });
}

export default async function BlogIndexPage({ params }: Params) {
  const { locale } = await params;
  // Italian workspaces write in English, so there is no Italian blog yet. Temporary
  // (307), not 308: an Italian blog later must not be hidden behind a cached redirect.
  if (!isBlogLocale(locale)) redirect({ href: '/blog', locale: 'en' });
  const blogLocale = locale as 'en' | 'fa';
  setRequestLocale(blogLocale);

  const [t, format, posts] = await Promise.all([
    getTranslations({ locale: blogLocale, namespace: 'blog' }),
    getFormatter({ locale: blogLocale }),
    fetchPostsForLocale(blogLocale),
  ]);

  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long', timeZone: 'UTC' });
  const jsonLd = indexJsonLd(blogLocale, posts, {
    title: t('meta.title'),
    description: t('meta.description'),
    home: t('crumbs.home'),
    blog: t('crumbs.blog'),
  });

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <SiteNav />

      <header className="mx-auto max-w-[90rem] px-5 pb-12 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <h1 className="mt-6 max-w-[18ch] font-display text-[clamp(2.4rem,5.6vw,4.6rem)] font-extrabold leading-[1.02] tracking-[-0.03em]">
          {t('title')}
        </h1>
        <p className="mt-8 max-w-[42rem] text-[19px] leading-[1.65] text-moss-muted">{t('intro')}</p>
      </header>

      <main className="mx-auto max-w-[90rem] px-5 pb-24 md:px-16">
        {posts.length === 0 ? (
          <section className="rounded-2xl border border-rule bg-chalk-raised p-8 md:p-12" aria-labelledby="empty">
            <h2 id="empty" className="font-display text-[clamp(1.6rem,2.6vw,2.1rem)] font-bold">
              {t('empty.title')}
            </h2>
            <p className="mt-3 max-w-[38rem] text-[17px] leading-relaxed text-moss-muted">{t('empty.body')}</p>
            <Link
              href="/features"
              className="mt-8 inline-flex h-12 items-center rounded-xl bg-moss px-6 text-[15px] font-semibold text-chalk transition-colors duration-200 hover:bg-moss-700"
            >
              {t('empty.cta')}
            </Link>
          </section>
        ) : (
          <ol className="divide-y divide-rule border-y border-rule">
            {posts.map((post) => (
              <li key={post.id}>
                <article className="grid gap-4 py-10 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-12">
                  <p className="flex flex-wrap gap-x-2 font-plexmono text-[13px] text-moss-muted">
                    <time dateTime={post.publishedAt} className="whitespace-nowrap">{day(post.publishedAt)}</time>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">{t('minutes', { count: readingMinutes(post.content, blogLocale) })}</span>
                  </p>
                  <div>
                    <h2 className="font-display text-[clamp(1.5rem,2.6vw,2.1rem)] font-bold leading-snug tracking-[-0.015em]">
                      <Link
                        href={{ pathname: '/blog/[slug]', params: { slug: post.slug } }}
                        className="underline decoration-transparent decoration-2 underline-offset-[6px] transition-colors hover:decoration-saffron"
                      >
                        {post.title}
                      </Link>
                    </h2>
                    {post.excerpt ? (
                      <p className="mt-3 max-w-[44rem] text-[17px] leading-[1.7] text-moss-muted">{post.excerpt}</p>
                    ) : null}
                    <Link
                      href={{ pathname: '/blog/[slug]', params: { slug: post.slug } }}
                      className="mt-5 inline-block text-[15px] font-semibold underline decoration-saffron decoration-2 underline-offset-[6px]"
                      aria-label={`${t('readMore')}: ${post.title}`}
                    >
                      {t('readMore')}
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-10 text-[14px] text-moss-muted">
          <a href={`/${blogLocale}/blog/feed.xml`} className="underline underline-offset-4 hover:text-moss">
            {t('rss')}
          </a>
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
