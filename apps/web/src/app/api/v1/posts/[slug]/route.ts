/**
 * GET /api/v1/posts/[slug]
 *
 * A single published post by slug, scoped to the key's workspace.
 * Returns 404 for both "no such slug" and "slug belongs to another workspace",
 * so the endpoint cannot be used to probe other customers' content.
 */

import { prisma } from '@/lib/db';
import { API_HEADERS, apiJson, authenticateSite } from '@/lib/site-api/auth';
import { serializePost } from '@/lib/site-api/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authenticateSite(request);
  if ('response' in auth) return auth.response;

  const { slug } = await context.params;

  const row = await prisma.contentItem.findFirst({
    where: {
      workspaceId: auth.site.workspaceId,
      slug,
      status: 'PUBLISHED',
    },
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

  if (!row) {
    return apiJson({ error: 'not_found', message: `No published post with slug "${slug}".` }, { status: 404 });
  }

  return apiJson({ post: serializePost(row) });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: API_HEADERS });
}
