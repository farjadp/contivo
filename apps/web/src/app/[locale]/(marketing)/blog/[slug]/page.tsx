/**
 * One article, read from Contivo's own Content API.
 *
 * Slugs known at build time are prerendered; a post published later renders
 * on its first request and is cached from then on.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { ArticleBody } from '@/components/blog/article-body';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link, permanentRedirect } from '@/i18n/navigation';
import { fetchAllPosts, fetchPost } from '@/lib/blog/api';
import { parseMarkdown, readingMinutes } from '@/lib/blog/content';
import { blogAuthor, isBlogLocale, postJsonLd, postMetadata, serializeJsonLd } from '@/lib/blog/metadata';

// Literal on purpose: Next reads segment config statically and ignores an imported constant.
export const revalidate = 600;
export const dynamicParams = true;

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateStaticParams() {
  const posts = await fetchAllPosts();
  return posts.map((p) => ({ locale: p.locale, slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await fetchPost(decodeURIComponent(slug));
  return post ? postMetadata(post) : {};
}

export default async function BlogPostPage({ params }: Params) {
  const { locale, slug } = await params;
  const post = await fetchPost(decodeURIComponent(slug));
  if (!post) notFound();

  // A post lives under the language it is written in; any other prefix redirects there.
  if (!isBlogLocale(locale) || post.locale !== locale) {
    permanentRedirect({ href: { pathname: '/blog/[slug]', params: { slug: post.slug } }, locale: post.locale });
  }
  setRequestLocale(post.locale);

  const [t, format] = await Promise.all([
    getTranslations({ locale: post.locale, namespace: 'blog' }),
    getFormatter({ locale: post.locale }),
  ]);

  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long', timeZone: 'UTC' });
  const updated = post.updatedAt.slice(0, 10) !== post.publishedAt.slice(0, 10);
  const author = blogAuthor();
  const jsonLd = postJsonLd(post, { home: t('crumbs.home'), blog: t('crumbs.blog') });

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <SiteNav />

      <article className="mx-auto max-w-[46rem] px-5 pb-20 pt-10 md:pt-16">
        <nav aria-label={t('crumbs.blog')} className="font-plexmono text-[12px] uppercase tracking-[0.12em] text-moss-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:text-moss">{t('crumbs.home')}</Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/blog" className="hover:text-moss">{t('crumbs.blog')}</Link>
            </li>
          </ol>
        </nav>

        <h1 className="mt-6 font-display text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[1.08] tracking-[-0.025em]">
          {post.title}
        </h1>

        <p className="mt-6 flex flex-wrap gap-x-3 gap-y-1 font-plexmono text-[13px] text-moss-muted">
          <span>{t('by', { author: author.name })}</span>
          <span aria-hidden>·</span>
          <span>{t('published', { date: day(post.publishedAt) })}</span>
          {updated ? (
            <>
              <span aria-hidden>·</span>
              <span>{t('updated', { date: day(post.updatedAt) })}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{t('minutes', { count: readingMinutes(post.content, post.locale) })}</span>
        </p>

        <div className="mt-4 border-t border-rule" />

        <ArticleBody blocks={parseMarkdown(post.content, post.title)} locale={post.locale} />

        <section className="mt-16 rounded-2xl bg-forest p-7 text-chalk md:p-10" aria-labelledby="cta">
          <h2 id="cta" className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-bold leading-snug">
            {t('ctaTitle')}
          </h2>
          <p className="mt-3 text-[17px] leading-relaxed text-forest-muted">{t('ctaBody')}</p>
          <Link
            href="/sign-up"
            className="mt-7 inline-flex h-12 items-center rounded-xl bg-saffron px-6 text-[15px] font-semibold text-moss transition-colors duration-200 hover:bg-saffron-soft"
          >
            {t('ctaStart')}
          </Link>
        </section>

        <p className="mt-10">
          <Link href="/blog" className="text-[15px] font-semibold underline decoration-saffron decoration-2 underline-offset-[6px]">
            {t('back')}
          </Link>
        </p>
      </article>

      <SiteFooter />
    </div>
  );
}
