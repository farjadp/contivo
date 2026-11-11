import { afterEach, describe, expect, it, vi } from 'vitest';

import { blogConfig, fetchAllPosts, fetchPost, fetchPostsForLocale, toBlogPost } from './api';

const config = { baseUrl: 'https://api.test/api/v1', apiKey: 'ctv_live_test' };

const en = {
  id: 'a1',
  slug: 'what-is-geo',
  title: 'What is GEO?',
  content: 'Generative engine optimisation is how you get cited by AI answers.',
  excerpt: 'Generative engine optimisation is how you get cited.',
  channel: 'blog',
  publishedAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};
const fa = {
  ...en,
  id: 'b2',
  slug: 'post-b2b2b2b2',
  title: 'سئو برای موتورهای پاسخ‌گو چیست؟',
  content: 'بهینه‌سازی برای موتورهای مولد یعنی دیده شدن در پاسخ‌های هوش مصنوعی و ChatGPT.',
  publishedAt: '2026-11-05T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('blogConfig', () => {
  it('defaults the API to the app URL and reads the key', () => {
    expect(blogConfig({ NEXT_PUBLIC_APP_URL: 'https://x.test/', CONTIVO_BLOG_API_KEY: ' k ' } as never)).toEqual({
      baseUrl: 'https://x.test/api/v1',
      apiKey: 'k',
    });
  });

  it('prefers an explicit API URL and treats a blank key as missing', () => {
    expect(blogConfig({ CONTIVO_BLOG_API_URL: 'http://localhost:3000/api/v1/', CONTIVO_BLOG_API_KEY: ' ' } as never)).toEqual({
      baseUrl: 'http://localhost:3000/api/v1',
      apiKey: null,
    });
  });
});

describe('fetchAllPosts', () => {
  it('sends the site key, tags the cache and returns posts newest first with a locale', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ posts: [en, fa], nextCursor: null }));
    const posts = await fetchAllPosts({ config, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/posts?limit=100',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ctv_live_test' }),
        next: expect.objectContaining({ tags: ['blog'] }),
      }),
    );
    expect(posts.map((p) => [p.slug, p.locale])).toEqual([
      ['post-b2b2b2b2', 'fa'],
      ['what-is-geo', 'en'],
    ]);
  });

  it('returns nothing without a key and never calls the API', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    expect(await fetchAllPosts({ config: { ...config, apiKey: null }, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([401, 500])('returns nothing on HTTP %i', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'x' }, status));
    expect(await fetchAllPosts({ config, fetchImpl })).toEqual([]);
  });

  it('returns nothing when the network fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await fetchAllPosts({ config, fetchImpl })).toEqual([]);
  });

  it('drops rows that cannot make a page', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ posts: [en, { ...en, slug: '' }, { ...en, publishedAt: null }, { ...en, title: 'x', publishedAt: 'nope' }, 'junk'] }),
    );
    expect((await fetchAllPosts({ config, fetchImpl })).map((p) => p.slug)).toEqual(['what-is-geo']);
  });
});

describe('fetchPostsForLocale', () => {
  it('keeps only the posts written in that language', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ posts: [en, fa] }));
    expect((await fetchPostsForLocale('fa', { config, fetchImpl })).map((p) => p.slug)).toEqual(['post-b2b2b2b2']);
    expect((await fetchPostsForLocale('en', { config, fetchImpl })).map((p) => p.slug)).toEqual(['what-is-geo']);
  });
});

describe('fetchPost', () => {
  it('fetches one post by encoded slug', async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () => jsonResponse({ post: en }));
    const post = await fetchPost('what is/geo', { config, fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/api/v1/posts/what%20is%2Fgeo');
    expect(post?.title).toBe('What is GEO?');
  });

  it('returns null on 404 without logging an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'not_found' }, 404));
    expect(await fetchPost('missing', { config, fetchImpl })).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('toBlogPost', () => {
  it('falls back to publishedAt when updatedAt is missing', () => {
    expect(toBlogPost({ ...en, updatedAt: undefined })?.updatedAt).toBe(en.publishedAt);
  });
});
