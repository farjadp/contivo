/**
 * content-slug.ts
 *
 * Pure validation for posts a user writes themselves (spec 2026-11-21,
 * write-own-post). No database access: uniqueness is checked by the server
 * action, backed by @@unique([workspaceId, slug]).
 */

export type OwnPostError =
  | 'title_required'
  | 'title_too_long'
  | 'body_required'
  | 'body_too_long'
  | 'slug_invalid'
  | 'slug_taken'
  | 'slug_frozen'
  | 'not_found'
  | 'invalid_channel';

export const POST_TITLE_MAX = 200;
export const POST_BODY_MAX = 100_000;
export const POST_SLUG_MAX = 80;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validatePostTitle(title: string): OwnPostError | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'title_required';
  if (trimmed.length > POST_TITLE_MAX) return 'title_too_long';
  return null;
}

export function validatePostBody(body: string): OwnPostError | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'body_required';
  if (trimmed.length > POST_BODY_MAX) return 'body_too_long';
  return null;
}

/** Expects an already-normalized slug; never rewrites it. */
export function validatePostSlug(slug: string): OwnPostError | null {
  if (slug.length === 0 || slug.length > POST_SLUG_MAX) return 'slug_invalid';
  if (!SLUG_PATTERN.test(slug)) return 'slug_invalid';
  return null;
}

/**
 * Trim and lowercase only. Invalid characters are left in place so the
 * validator rejects them and the user sees why, rather than getting a slug
 * they did not type.
 */
export function normalizeSlugInput(slug: string): string {
  return slug.trim().toLowerCase();
}
