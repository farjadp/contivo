/**
 * site-api/posts.ts
 *
 * Shapes ContentItem rows into the payload websites consume, and owns slug
 * generation. Kept separate from the route handlers so the publisher and the
 * read API agree on one representation.
 */

import { prisma } from '@/lib/db';

export type ApiPost = {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  channel: string;
  publishedAt: string | null;
  updatedAt: string;
};

type PostRow = {
  id: string;
  slug: string | null;
  topic: string;
  content: string;
  channel: string;
  publishedAtUtc: Date | null;
  updatedAt: Date;
};

export function serializePost(row: PostRow): ApiPost {
  const content = String(row.content || '');
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    title: row.topic,
    content,
    excerpt: buildExcerpt(content),
    channel: String(row.channel),
    publishedAt: row.publishedAtUtc?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildExcerpt(content: string, maxLength = 200): string {
  const flat = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function slugify(input: string): string {
  const base = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return base || 'post';
}

/**
 * Returns a slug unique within the workspace, appending -2, -3 … on collision.
 * Non-latin titles slugify to nothing, so those fall back to `post-<id>`.
 */
export async function buildUniqueSlug(
  workspaceId: string,
  title: string,
  itemId: string,
): Promise<string> {
  let base = slugify(title);
  if (base === 'post') base = `post-${itemId.slice(-8)}`;

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await prisma.contentItem.findFirst({
      where: { workspaceId, slug: candidate, NOT: { id: itemId } },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // Astronomically unlikely; guarantees termination with a unique value.
  return `${base}-${itemId.slice(-8)}`;
}
