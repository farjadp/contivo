/**
 * GET /api/v1/posts
 *
 * Published posts for the site that owns the API key. This is the endpoint a
 * customer's website calls, so it is scoped strictly to the key's workspace.
 *
 * Auth:  Authorization: Bearer <site key>
 * Query: ?limit=1..100 (default 20)  ?cursor=<id from nextCursor>
 *        ?channel=blog (default: blog only — social posts are not web pages)
 */

import { prisma } from '@/lib/db';
import { API_HEADERS, apiJson, authenticateSite } from '@/lib/site-api/auth';
import { serializePost } from '@/lib/site-api/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const auth = await authenticateSite(request);
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitParam)))
    : DEFAULT_LIMIT;
  const cursor = url.searchParams.get('cursor');
  const channel = (url.searchParams.get('channel') || 'blog').toLowerCase();

  const rows = await prisma.contentItem.findMany({
    where: {
      workspaceId: auth.site.workspaceId,
      status: 'PUBLISHED',
      slug: { not: null },
      ...(channel === 'all' ? {} : { channel: channel as never }),
    },
    orderBy: [{ publishedAtUtc: 'desc' }, { id: 'desc' }],
    take: limit + 1, // one extra row tells us whether another page exists
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      slug: true,
      topic: true,
      content: true,
      channel: true,
      publishedAtUtc: true,
      updatedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return apiJson({
    posts: page.map(serializePost),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: API_HEADERS });
}
