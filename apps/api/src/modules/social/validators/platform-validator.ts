/**
 * platform-validator.ts
 *
 * Pure validation functions for each social platform.
 * Called by adapters (validatePayload) and optionally by the publish service
 * before dispatching a job to the queue.
 *
 * All validators are side-effect-free and synchronous.
 */

import { PublishPayload, ValidationResult } from '../adapters/social-adapter.interface';

// ─── Platform limits (source of truth) ───────────────────────────────────────

export const PLATFORM_LIMITS = {
  LINKEDIN: { minChars: 1, maxChars: 3000 },
  X:        { maxChars: 280 },
  FACEBOOK: { minChars: 1, maxChars: 63206 },
  INSTAGRAM: { minCaptionChars: 1, maxCaptionChars: 2200 },
} as const;

// ─── Validators ───────────────────────────────────────────────────────────────

/** LinkedIn: text 1–3000 chars; link optional; image deferred to Phase 2. */
export function validateLinkedIn(payload: PublishPayload): ValidationResult {
  const errors: string[] = [];

  if (!payload.body || payload.body.trim().length === 0) {
    errors.push('LinkedIn post body cannot be empty.');
  }

  if (payload.body.length > PLATFORM_LIMITS.LINKEDIN.maxChars) {
    errors.push(
      `LinkedIn post exceeds max ${PLATFORM_LIMITS.LINKEDIN.maxChars} characters ` +
      `(current: ${payload.body.length}).`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/** X: ≤280 chars per tweet. Thread support deferred to Phase 2. */
export function validateX(payload: PublishPayload): ValidationResult {
  const errors: string[] = [];

  if (!payload.body || payload.body.trim().length === 0) {
    errors.push('X post body cannot be empty.');
  }

  // URLs count as ~23 chars in X's weighting — we do a simple check for MVP
  const effectiveLength = payload.body.length;
  if (effectiveLength > PLATFORM_LIMITS.X.maxChars) {
    errors.push(
      `X post exceeds ${PLATFORM_LIMITS.X.maxChars} characters ` +
      `(current: ${effectiveLength}). Use thread mode for longer content.`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/** Facebook Page: text + optional link; page must be selected (pageId checked at job level). */
export function validateFacebook(payload: PublishPayload): ValidationResult {
  const errors: string[] = [];

  if (!payload.body || payload.body.trim().length === 0) {
    errors.push('Facebook post body cannot be empty.');
  }

  if (payload.body.length > PLATFORM_LIMITS.FACEBOOK.maxChars) {
    errors.push(
      `Facebook post exceeds max ${PLATFORM_LIMITS.FACEBOOK.maxChars} characters.`,
    );
  }

  if (payload.linkUrl) {
    try {
      new URL(payload.linkUrl);
    } catch {
      errors.push('Facebook link URL is not a valid URL.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Instagram: media required (Phase 2). Validates caption length as a stub. */
export function validateInstagram(payload: PublishPayload): ValidationResult {
  const errors: string[] = [
    'Instagram publishing requires a media asset (image/video). ' +
    'This feature is available in Phase 2.',
  ];

  if (payload.body.length > PLATFORM_LIMITS.INSTAGRAM.maxCaptionChars) {
    errors.push(
      `Instagram caption exceeds ${PLATFORM_LIMITS.INSTAGRAM.maxCaptionChars} characters.`,
    );
  }

  // Always invalid until media pipeline exists
  return { valid: false, errors };
}
