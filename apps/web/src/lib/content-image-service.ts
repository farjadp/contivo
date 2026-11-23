/**
 * content-image-service.ts
 *
 * Server only. The one place a person changes a post's picture: generate one
 * from the post (charged in credits), upload their own (PNG/JPG), or remove
 * it. The pipeline card, the Ideation tab and Write a post all come here.
 *
 * Every item lookup carries the workspace AND the user in the query, so an id
 * from the browser that belongs to someone else is simply not found. An item
 * that is publishing or published keeps the picture it went out with.
 *
 * A failed generation never fails the post: the item keeps its text, nothing
 * is charged, and the result carries a reference (CTV-XXXX) that the screen
 * shows next to "no image, this post will publish as text only".
 */

import { recordActionFailure } from '@/lib/bug-report/action-failure';
import { CAUSE_CODES, type CauseCode } from '@/lib/bug-report/types';
import { writeActivityLog } from '@/lib/activity-log';
import { generateImageForContentItem } from '@/lib/content-image';
import {
  imageEditableForStatus,
  readImageSize,
  uploadAltText,
  validateImageBytes,
  type ImageUploadError,
} from '@/lib/content-image-rules';
import { IMAGE_GENERATION_COST } from '@/lib/credit-costs';
import { deductCredits, getCreditBalance } from '@/lib/credits';
import { prisma } from '@/lib/db';

export type ImageActor = { userId: string; workspaceId: string };

export type ContentImageMeta = { id: string; altText: string | null; mimeType: string; source: 'generated' | 'upload' };

export type ImageActionError = 'not_found' | 'locked' | 'insufficient_credits' | 'generation_failed' | ImageUploadError;

export type ImageActionResult =
  | { ok: true; image: ContentImageMeta | null }
  | { ok: false; error: ImageActionError; ref?: string; balance?: number; required?: number };

/** `provider` value for a picture the user supplied. */
export const UPLOAD_PROVIDER = 'upload';

export function imageMetaFromRow(row: { id: string; altText: string | null; mimeType: string; provider: string }): ContentImageMeta {
  return {
    id: row.id,
    altText: row.altText,
    mimeType: row.mimeType,
    source: row.provider === UPLOAD_PROVIDER ? 'upload' : 'generated',
  };
}

/**
 * What the generator returned, read without trusting its shape. Today it is
 * the image or null; the B19 fix (model registry, head-of-data) returns a
 * coded failure instead. A result counts as an image only when it carries an
 * id, so a failure object can never pass as a picture. `failureCode` is the
 * generator's own code (e.g. MODEL_UNAVAILABLE), kept for the log.
 */
export function readGeneratorResult(
  raw: unknown,
): { ok: true; id: string; altText: string; bytes: number } | { ok: false; cause: CauseCode; failureCode: string | null } {
  const r = (raw ?? null) as { id?: unknown; altText?: unknown; bytes?: unknown; ok?: unknown; code?: unknown; cause?: unknown } | null;
  if (r && r.ok !== false && typeof r.id === 'string' && r.id) {
    return { ok: true, id: r.id, altText: typeof r.altText === 'string' ? r.altText : '', bytes: Number(r.bytes) || 0 };
  }
  const named = [r?.cause, r?.code].find((v): v is string => typeof v === 'string' && v.length > 0) ?? null;
  const cause = named && (CAUSE_CODES as readonly string[]).includes(named) ? (named as CauseCode) : 'PROVIDER_UNAVAILABLE';
  return { ok: false, cause, failureCode: named };
}

async function findItem(actor: ImageActor, itemId: string) {
  if (typeof itemId !== 'string' || !itemId) return null;
  return prisma.contentItem.findFirst({
    where: { id: itemId, workspaceId: actor.workspaceId, workspace: { userId: actor.userId } },
    select: { id: true, topic: true, content: true, status: true, channel: true, workspace: { select: { brandSummary: true } } },
  });
}

export async function generateImageForItem(actor: ImageActor, itemId: string): Promise<ImageActionResult> {
  const item = await findItem(actor, itemId);
  if (!item) return { ok: false, error: 'not_found' };
  if (!imageEditableForStatus(item.status)) return { ok: false, error: 'locked' };

  // Checked before the model runs; charged only after the picture is stored.
  const balance = await getCreditBalance(actor.userId);
  if (balance < IMAGE_GENERATION_COST) {
    return { ok: false, error: 'insufficient_credits', balance, required: IMAGE_GENERATION_COST };
  }

  const image = readGeneratorResult(
    await generateImageForContentItem({
      contentItemId: item.id,
      workspaceId: actor.workspaceId,
      topic: item.topic,
      body: item.content ?? '',
      brandSummary: item.workspace?.brandSummary ?? null,
    }),
  );

  if (!image.ok) {
    const { ref } = await recordActionFailure({
      action: 'generateContentImage',
      error: new Error(`content image generation failed: ${image.failureCode ?? 'no image'}`),
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      code: image.cause,
    });
    await writeActivityLog({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      action: 'CONTENT_IMAGE_FAILED',
      detail: { itemId: item.id, ref, cause: image.cause, failureCode: image.failureCode, textOnly: true },
    });
    return { ok: false, error: 'generation_failed', ref };
  }

  await deductCredits(actor.userId, IMAGE_GENERATION_COST, 'IMAGE_GENERATION', item.id);
  await writeActivityLog({
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    action: 'CONTENT_IMAGE_GENERATED',
    detail: { itemId: item.id, imageId: image.id, bytes: image.bytes, credits: IMAGE_GENERATION_COST },
  });
  return { ok: true, image: { id: image.id, altText: image.altText, mimeType: 'image/png', source: 'generated' } };
}

export async function uploadImageForItem(actor: ImageActor, itemId: string, bytes: Uint8Array): Promise<ImageActionResult> {
  const item = await findItem(actor, itemId);
  if (!item) return { ok: false, error: 'not_found' };
  if (!imageEditableForStatus(item.status)) return { ok: false, error: 'locked' };

  const checked = validateImageBytes(bytes);
  if (!checked.ok) return { ok: false, error: checked.error };
  const size = readImageSize(bytes, checked.mimeType);
  const altText = uploadAltText(item.topic);

  // One picture per item, the same rule the generator follows.
  const row = await prisma.$transaction(async (tx) => {
    await tx.contentImage.deleteMany({ where: { contentItemId: item.id } });
    return tx.contentImage.create({
      data: {
        contentItemId: item.id,
        workspaceId: actor.workspaceId,
        data: Buffer.from(bytes),
        mimeType: checked.mimeType,
        width: size?.width ?? null,
        height: size?.height ?? null,
        prompt: null,
        altText,
        provider: UPLOAD_PROVIDER,
      },
      select: { id: true, altText: true, mimeType: true, provider: true },
    });
  });

  await writeActivityLog({
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    action: 'CONTENT_IMAGE_UPLOADED',
    detail: { itemId: item.id, imageId: row.id, bytes: bytes.byteLength, mimeType: checked.mimeType },
  });
  return { ok: true, image: imageMetaFromRow(row) };
}

export async function removeImageForItem(actor: ImageActor, itemId: string): Promise<ImageActionResult> {
  const item = await findItem(actor, itemId);
  if (!item) return { ok: false, error: 'not_found' };
  if (!imageEditableForStatus(item.status)) return { ok: false, error: 'locked' };

  const removed = await prisma.contentImage.deleteMany({ where: { contentItemId: item.id } });
  if (removed.count > 0) {
    await writeActivityLog({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      action: 'CONTENT_IMAGE_REMOVED',
      detail: { itemId: item.id },
    });
  }
  return { ok: true, image: null };
}
