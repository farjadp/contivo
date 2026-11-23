'use server';

// apps/web/src/app/actions/content-image.ts
//
// Generate or remove a post's picture. Uploads go through
// /api/content/[id]/image instead: a server action body is capped at 1 MB and
// a photo is not. Both end in lib/content-image-service.ts.

import { getSession } from '@/lib/auth';
import {
  generateImageForItem,
  removeImageForItem,
  type ImageActionResult,
} from '@/lib/content-image-service';

async function actorFor(workspaceId: string) {
  const session = await getSession();
  if (!session?.userId || typeof workspaceId !== 'string' || !workspaceId) return null;
  return { userId: session.userId as string, workspaceId };
}

export async function generateContentImage(workspaceId: string, itemId: string): Promise<ImageActionResult> {
  const actor = await actorFor(workspaceId);
  if (!actor) return { ok: false, error: 'not_found' };
  return generateImageForItem(actor, itemId);
}

export async function removeContentImage(workspaceId: string, itemId: string): Promise<ImageActionResult> {
  const actor = await actorFor(workspaceId);
  if (!actor) return { ok: false, error: 'not_found' };
  return removeImageForItem(actor, itemId);
}
