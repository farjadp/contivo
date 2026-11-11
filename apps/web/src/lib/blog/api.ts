/**
 * blog/api.ts
 *
 * contivo.app's own blog reads its posts from the Content API, with a site key
 * for Contivo's own workspace, exactly as a customer's website does. If this
 * breaks, the Content API is broken for customers too, and we see it first.
 *
 * Server-only: the key is a secret and must never reach the browser. It is not
 * a NEXT_PUBLIC_ variable, so a client import would read undefined, not the key.
 *
 * Every failure (no key, API down, 401, malformed payload) resolves to "no
 * posts" plus one `[blog]` log line, never a thrown error. The blog is
 * statically rendered, and an unreachable API must not fail `next build`.
 */

import { detectPostLocale, type BlogLocale } from './content';

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  locale: BlogLocale;
  publishedAt: string;
  updatedAt: string;
};

/** Cache tag every blog fetch carries; `/api/blog/revalidate` clears it. */
export const BLOG_CACHE_TAG = 'blog';
/** Seconds a cached page is served before Next refetches in the background. */
export const BLOG_REVALIDATE_SECONDS = 600;

type BlogConfig = { baseUrl: string; apiKey: string | null };

export function blogConfig(env: NodeJS.ProcessEnv = process.env): BlogConfig {
  const appUrl = (env.NEXT_PUBLIC_APP_URL || 'https://www.contivo.app').replace(/\/$/, '');
  const baseUrl = (env.CONTIVO_BLOG_API_URL?.trim() || `${appUrl}/api/v1`).replace(/\/$/, '');
  return { baseUrl, apiKey: env.CONTIVO_BLOG_API_KEY?.trim() || null };
}

type FetchLike = (input: string, init?: RequestInit & { next?: unknown }) => Promise<Response>;

type Deps = { config?: BlogConfig; fetchImpl?: FetchLike };

async function getJson(path: string, deps: Deps): Promise<{ status: number; body: unknown } | null> {
  const config = deps.config ?? blogConfig();
  if (!config.apiKey) {
    console.warn('[blog] CONTIVO_BLOG_API_KEY is not set; the blog shows no posts.');
    return null;
  }
  const fetchImpl = deps.fetchImpl ?? (fetch as FetchLike);
  try {
    const res = await fetchImpl(`${config.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      next: { revalidate: BLOG_REVALIDATE_SECONDS, tags: [BLOG_CACHE_TAG] },
    });
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) {
      console.error(`[blog] Content API ${path} returned ${res.status}.`);
      return null;
    }
    return { status: res.status, body: await res.json() };
  } catch (err) {
    console.error(`[blog] Content API ${path} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Shapes one row of the API payload. Rows missing what a page needs (a slug,
 * a title, a publish date) are dropped rather than rendered half-empty.
 */
export function toBlogPost(raw: unknown): BlogPost | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const slug = str(r.slug).trim();
  const title = str(r.title).trim();
  const publishedAt = str(r.publishedAt);
  if (!slug || !title || !publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
  const content = str(r.content);
  const updatedAt = str(r.updatedAt);
  return {
    id: str(r.id) || slug,
    slug,
    title,
    content,
    excerpt: str(r.excerpt).trim(),
    locale: detectPostLocale(title, content),
    publishedAt,
    updatedAt: updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? updatedAt : publishedAt,
  };
}

/**
 * Every published post, newest first. One page of up to 100 — enough for two
 * years at three a week; past that the index needs pagination.
 */
export async function fetchAllPosts(deps: Deps = {}): Promise<BlogPost[]> {
  const result = await getJson('/posts?limit=100', deps);
  const list = (result?.body as { posts?: unknown } | null)?.posts;
  if (!Array.isArray(list)) {
    if (result && result.status !== 404) console.error('[blog] Content API returned no posts array.');
    return [];
  }
  return list
    .map(toBlogPost)
    .filter((p): p is BlogPost => p !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export async function fetchPostsForLocale(locale: string, deps: Deps = {}): Promise<BlogPost[]> {
  return (await fetchAllPosts(deps)).filter((p) => p.locale === locale);
}

/** One post by slug, or null when it does not exist or the API is unreachable. */
export async function fetchPost(slug: string, deps: Deps = {}): Promise<BlogPost | null> {
  const result = await getJson(`/posts/${encodeURIComponent(slug)}`, deps);
  if (!result || result.status === 404) return null;
  return toBlogPost((result.body as { post?: unknown } | null)?.post);
}
