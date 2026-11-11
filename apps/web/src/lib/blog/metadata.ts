/**
 * blog/metadata.ts
 *
 * Metadata, structured data and the RSS feed for the blog. Pure functions, so
 * the SEO contract is tested without rendering a page.
 *
 * hreflang rule: the index exists in English and Persian, so it declares both.
 * A post exists in one language only (there is no translation link in the
 * data), so it declares only itself. Pointing a twin hreflang at a page with
 * different content is worse than declaring none.
 */

import type { Metadata } from 'next';

import { siteIdentity } from '@/lib/site-identity';

import type { BlogPost } from './api';
import { extractFaq, parseMarkdown, type BlogLocale } from './content';

export const BLOG_LOCALES: readonly BlogLocale[] = ['en', 'fa'];

export function isBlogLocale(locale: string): locale is BlogLocale {
  return (BLOG_LOCALES as readonly string[]).includes(locale);
}

export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL || 'https://www.contivo.app').replace(/\/$/, '');
}

export const blogPath = (locale: string) => `/${locale}/blog`;
export const postPath = (locale: string, slug: string) => `/${locale}/blog/${encodeURIComponent(slug)}`;
export const feedPath = (locale: string) => `/${locale}/blog/feed.xml`;

const OG_LOCALE: Record<BlogLocale, string> = { en: 'en_US', fa: 'fa_IR' };

type IndexLabels = { title: string; description: string; feedTitle: string };

export function indexMetadata(locale: BlogLocale, labels: IndexLabels): Metadata {
  return {
    title: labels.title,
    description: labels.description,
    alternates: {
      canonical: blogPath(locale),
      languages: { en: blogPath('en'), fa: blogPath('fa'), 'x-default': blogPath('en') },
      types: { 'application/rss+xml': [{ url: feedPath(locale), title: labels.feedTitle }] },
    },
    openGraph: {
      type: 'website',
      title: labels.title,
      description: labels.description,
      url: blogPath(locale),
      locale: OG_LOCALE[locale],
      siteName: 'Contivo',
    },
  };
}

export function postDescription(post: BlogPost): string {
  const text = post.excerpt || post.title;
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

export function postMetadata(post: BlogPost): Metadata {
  const description = postDescription(post);
  const author = blogAuthor();
  return {
    title: post.title,
    description,
    alternates: {
      canonical: postPath(post.locale, post.slug),
      languages: { [post.locale]: postPath(post.locale, post.slug) },
    },
    authors: [{ name: author.name }],
    openGraph: {
      type: 'article',
      title: post.title,
      description,
      url: postPath(post.locale, post.slug),
      locale: OG_LOCALE[post.locale],
      siteName: 'Contivo',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [author.name],
    },
    twitter: { card: 'summary', title: post.title, description },
  };
}

/** The API carries no author: a named person when configured, else the company. */
export function blogAuthor(env: NodeJS.ProcessEnv = process.env): { type: 'Person' | 'Organization'; name: string } {
  const name = env.CONTIVO_BLOG_AUTHOR_NAME?.trim();
  return name ? { type: 'Person', name } : { type: 'Organization', name: siteIdentity.entity };
}

type Crumbs = { home: string; blog: string };

function breadcrumbs(base: string, locale: BlogLocale, crumbs: Crumbs, post?: BlogPost) {
  const items = [
    { name: crumbs.home, url: `${base}/${locale}` },
    { name: crumbs.blog, url: `${base}${blogPath(locale)}` },
    ...(post ? [{ name: post.title, url: `${base}${postPath(locale, post.slug)}` }] : []),
  ];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

const publisher = (base: string) => ({
  '@type': 'Organization',
  name: 'Contivo',
  url: base,
  parentOrganization: { '@type': 'Organization', name: siteIdentity.entity },
});

/** BlogPosting + BreadcrumbList, plus FAQPage when the article shows a FAQ. */
export function postJsonLd(post: BlogPost, crumbs: Crumbs, base = siteUrl()) {
  const url = `${base}${postPath(post.locale, post.slug)}`;
  const author = blogAuthor();
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      headline: post.title,
      description: postDescription(post),
      inLanguage: post.locale,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      author: { '@type': author.type, name: author.name },
      publisher: publisher(base),
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      isPartOf: { '@type': 'Blog', '@id': `${base}${blogPath(post.locale)}#blog` },
    },
    breadcrumbs(base, post.locale, crumbs, post),
  ];

  const faq = extractFaq(parseMarkdown(post.content, post.title));
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((entry) => ({
        '@type': 'Question',
        name: entry.question,
        acceptedAnswer: { '@type': 'Answer', text: entry.answer },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

export function indexJsonLd(
  locale: BlogLocale,
  posts: BlogPost[],
  labels: { title: string; description: string } & Crumbs,
  base = siteUrl(),
) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Blog',
        '@id': `${base}${blogPath(locale)}#blog`,
        name: labels.title,
        description: labels.description,
        url: `${base}${blogPath(locale)}`,
        inLanguage: locale,
        publisher: publisher(base),
        blogPost: posts.map((p) => ({
          '@type': 'BlogPosting',
          headline: p.title,
          url: `${base}${postPath(locale, p.slug)}`,
          datePublished: p.publishedAt,
          dateModified: p.updatedAt,
        })),
      },
      breadcrumbs(base, locale, labels),
    ],
  };
}

/**
 * JSON-LD goes into a <script> tag, so `<` is escaped: a title containing
 * "</script>" must not be able to close the tag and inject markup.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** RSS 2.0 for one locale's posts. */
export function buildRss(
  locale: BlogLocale,
  posts: BlogPost[],
  labels: { title: string; description: string },
  base = siteUrl(),
): string {
  const items = posts
    .map((p) => {
      const url = `${base}${postPath(locale, p.slug)}`;
      return [
        '    <item>',
        `      <title>${xml(p.title)}</title>`,
        `      <link>${xml(url)}</link>`,
        `      <guid isPermaLink="true">${xml(url)}</guid>`,
        `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        `      <description>${xml(postDescription(p))}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xml(labels.title)}</title>`,
    `    <link>${xml(`${base}${blogPath(locale)}`)}</link>`,
    `    <description>${xml(labels.description)}</description>`,
    `    <language>${locale}</language>`,
    `    <atom:link href="${xml(`${base}${feedPath(locale)}`)}" rel="self" type="application/rss+xml" />`,
    ...(posts[0] ? [`    <lastBuildDate>${new Date(posts[0].updatedAt).toUTCString()}</lastBuildDate>`] : []),
    items,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');
}
