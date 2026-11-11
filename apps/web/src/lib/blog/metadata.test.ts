import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlogPost } from './api';
import { buildRss, indexJsonLd, indexMetadata, postJsonLd, postMetadata, serializeJsonLd } from './metadata';

const base = 'https://www.contivo.app';
const crumbs = { home: 'Home', blog: 'Blog' };

const post: BlogPost = {
  id: 'a1',
  slug: 'what-is-geo',
  title: 'What is GEO?',
  content: '## Intro\n\nText.\n\n## FAQ\n\n### Is it new?\n\nYes, since 2024.',
  excerpt: 'Generative engine optimisation, explained.',
  locale: 'en',
  publishedAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

afterEach(() => vi.unstubAllEnvs());

describe('postMetadata', () => {
  it('declares its own canonical and only its own language', () => {
    const meta = postMetadata(post);
    expect(meta.alternates?.canonical).toBe('/en/blog/what-is-geo');
    expect(meta.alternates?.languages).toEqual({ en: '/en/blog/what-is-geo' });
    expect(meta.description).toBe('Generative engine optimisation, explained.');
  });

  it('carries real article dates', () => {
    const og = postMetadata(post).openGraph as Record<string, unknown>;
    expect(og.type).toBe('article');
    expect(og.publishedTime).toBe('2026-11-01T10:00:00.000Z');
    expect(og.modifiedTime).toBe('2026-11-02T10:00:00.000Z');
  });

  it('uses a Persian post URL under /fa', () => {
    expect(postMetadata({ ...post, locale: 'fa', slug: 'post-1' }).alternates?.canonical).toBe('/fa/blog/post-1');
  });
});

describe('indexMetadata', () => {
  it('pairs en and fa, leaves Italian out and links the feed', () => {
    const meta = indexMetadata('fa', { title: 'وبلاگ', description: 'd', feedTitle: 'f' });
    expect(meta.alternates?.canonical).toBe('/fa/blog');
    expect(meta.alternates?.languages).toEqual({ en: '/en/blog', fa: '/fa/blog', 'x-default': '/en/blog' });
    expect(meta.alternates?.types).toEqual({ 'application/rss+xml': [{ url: '/fa/blog/feed.xml', title: 'f' }] });
  });
});

describe('postJsonLd', () => {
  it('emits BlogPosting, BreadcrumbList and FAQPage with absolute URLs', () => {
    const ld = postJsonLd(post, crumbs, base);
    const types = ld['@graph'].map((n) => n['@type']);
    expect(types).toEqual(['BlogPosting', 'BreadcrumbList', 'FAQPage']);

    const article = ld['@graph'][0]!;
    expect(article.datePublished).toBe(post.publishedAt);
    expect(article.dateModified).toBe(post.updatedAt);
    expect(article.inLanguage).toBe('en');
    expect(article.url).toBe('https://www.contivo.app/en/blog/what-is-geo');

    const crumbsNode = ld['@graph'][1] as { itemListElement: { item: string }[] };
    expect(crumbsNode.itemListElement.map((i) => i.item)).toEqual([
      'https://www.contivo.app/en',
      'https://www.contivo.app/en/blog',
      'https://www.contivo.app/en/blog/what-is-geo',
    ]);

    expect(ld['@graph'][2]).toEqual({
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Is it new?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, since 2024.' } }],
    });
  });

  it('omits FAQPage when the article has no FAQ', () => {
    const ld = postJsonLd({ ...post, content: 'Just text.' }, crumbs, base);
    expect(ld['@graph'].map((n) => n['@type'])).toEqual(['BlogPosting', 'BreadcrumbList']);
  });

  it('names a person when CONTIVO_BLOG_AUTHOR_NAME is set, otherwise the company', () => {
    expect(postJsonLd(post, crumbs, base)['@graph'][0]!.author).toMatchObject({ '@type': 'Organization' });
    vi.stubEnv('CONTIVO_BLOG_AUTHOR_NAME', 'Farjad P.D');
    expect(postJsonLd(post, crumbs, base)['@graph'][0]!.author).toEqual({ '@type': 'Person', name: 'Farjad P.D' });
  });
});

describe('indexJsonLd', () => {
  it('lists every post in the Blog node', () => {
    const ld = indexJsonLd('en', [post], { title: 'Blog', description: 'd', ...crumbs }, base);
    const blog = ld['@graph'][0] as { blogPost: { url: string }[] };
    expect(blog.blogPost.map((p) => p.url)).toEqual(['https://www.contivo.app/en/blog/what-is-geo']);
  });
});

describe('serializeJsonLd', () => {
  it('cannot close the script tag', () => {
    expect(serializeJsonLd({ t: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });
});

describe('buildRss', () => {
  it('escapes titles and links each item', () => {
    const rss = buildRss('en', [{ ...post, title: 'A & B <C>' }], { title: 'Contivo blog', description: 'd' }, base);
    expect(rss).toContain('<title>A &amp; B &lt;C&gt;</title>');
    expect(rss).toContain('<link>https://www.contivo.app/en/blog/what-is-geo</link>');
    expect(rss).toContain('<language>en</language>');
    expect(rss).toContain('<pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate>');
  });
});
