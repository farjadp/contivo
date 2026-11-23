/**
 * Pure: which notice a failed image action shows. Kept out of the component
 * so the "never fail silently" rule is tested: every failure maps to words,
 * and a failed generation always carries its reference when there is one.
 */

import type { ImageActionResult } from '@/lib/content-image-service';

export type ImageNotice =
  | { kind: 'failed'; ref: string | null }
  | { kind: 'credits'; required: number; balance: number }
  | { kind: 'locked' }
  | { kind: 'not_found' }
  | { kind: 'upload'; error: 'empty' | 'too_large' | 'wrong_type' | 'network' };

export function imageNotice(result: Extract<ImageActionResult, { ok: false }>): ImageNotice {
  switch (result.error) {
    case 'generation_failed':
      return { kind: 'failed', ref: result.ref ?? null };
    case 'insufficient_credits':
      return { kind: 'credits', required: result.required ?? 0, balance: result.balance ?? 0 };
    case 'locked':
      return { kind: 'locked' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'empty':
    case 'too_large':
    case 'wrong_type':
      return { kind: 'upload', error: result.error };
    default:
      return { kind: 'failed', ref: null };
  }
}
