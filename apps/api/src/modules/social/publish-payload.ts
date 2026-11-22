/**
 * publish-payload.ts
 *
 * The one builder that turns a ContentItem into a PublishPayload. Used by the
 * scheduler for the first attempt and by retry(), so a retry publishes exactly
 * what the first attempt would have — not an empty body.
 */

import type { PublishPayload } from './adapters/social-adapter.interface';
import { PermanentPublishError } from './publish-errors';

export interface PublishableItem {
  id: string;
  topic: string;
  content: string | null;
  slug?: string | null;
}

export function buildPublishPayload(item: PublishableItem): PublishPayload {
  const body = item.content ?? '';
  if (body.trim().length === 0) {
    // Posting the bare topic instead would publish something nobody wrote.
    throw new PermanentPublishError(`Content item ${item.id} has no body to publish.`);
  }
  return {
    body,
    hashtags: [],
    title: item.topic,
    slug: item.slug ?? undefined,
    format: 'markdown',
  };
}
