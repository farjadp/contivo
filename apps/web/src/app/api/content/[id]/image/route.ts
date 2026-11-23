/**
 * /api/content/:id/image — a post's picture, for the account that owns it.
 *
 * GET returns the bytes (pipeline card thumbnail, Write a post preview).
 * POST takes a PNG or JPG upload (multipart field "file", ?workspaceId=) and
 * replaces the item's picture; the Nest publisher reads the same
 * content_images row, so an uploaded picture publishes like a generated one.
 *
 * A route rather than a server action because action bodies are capped at
 * 1 MB. The owner check is part of every query: someone else's item is 404.
 */

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { IMAGE_UPLOAD_MAX_BYTES } from '@/lib/content-image-rules';
import { uploadImageForItem } from '@/lib/content-image-service';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const image = await prisma.contentImage.findFirst({
    where: { contentItemId: id, contentItem: { workspace: { userId: session.userId as string } } },
    orderBy: { createdAt: 'desc' },
    select: { data: true, mimeType: true },
  });
  if (!image?.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType || 'image/png',
      // Private: a shared cache must never hold one account's picture. The
      // card adds ?v=<image id> so a replaced picture is fetched again.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 401 });

  const { id } = await params;
  const workspaceId = new URL(request.url).searchParams.get('workspaceId') ?? '';

  // Refuse an oversized body before reading it.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > IMAGE_UPLOAD_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413 });
  }

  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return NextResponse.json({ ok: false, error: 'wrong_type' }, { status: 400 });
  }
  if (!file || typeof file === 'string') return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadImageForItem({ userId: session.userId as string, workspaceId }, id, bytes);
  const status = result.ok
    ? 200
    : result.error === 'not_found'
      ? 404
      : result.error === 'locked'
        ? 409
        : result.error === 'too_large'
          ? 413
          : 400;
  return NextResponse.json(result, { status });
}
