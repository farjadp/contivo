/**
 * POST /api/blog/revalidate
 *
 * The Content API publisher pings this after a contivo.app post goes live
 * (set it as the revalidate URL on the contivo.app site connection, with the
 * same secret). Clearing the `blog` tag refreshes the index, every article,
 * the RSS feeds and the sitemap on their next request.
 */

import { timingSafeEqual } from 'crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { BLOG_CACHE_TAG } from '@/lib/blog/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, '').trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const secret = process.env.CONTIVO_BLOG_REVALIDATE_SECRET?.trim();
  if (!secret) {
    console.error('[blog] CONTIVO_BLOG_REVALIDATE_SECRET is not set; refusing to revalidate.');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!authorised(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Every blog fetch carries this tag, and Next regenerates the pages, feeds
  // and sitemap that read a tagged fetch on their next request.
  revalidateTag(BLOG_CACHE_TAG);

  return NextResponse.json({ revalidated: true });
}
