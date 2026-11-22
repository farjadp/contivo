/**
 * The `?cohort=` tag from a sign-up link, shared by the password sign-up
 * (actions/auth.ts) and the OAuth sign-up (lib/oauth).
 */

const COHORT_SHAPE = /^[a-z0-9][a-z0-9-_]{0,39}$/;

/**
 * Kept only if it is well-formed and on the SIGNUP_COHORTS allowlist
 * (comma-separated, exact match). Anyone can edit a URL, so an unlisted tag is
 * dropped, never stored; the sign-up itself goes ahead either way.
 */
export function allowedCohort(raw: unknown): string | null {
  if (typeof raw !== 'string' || !COHORT_SHAPE.test(raw)) return null;
  const allowlist = (process.env.SIGNUP_COHORTS ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return allowlist.includes(raw) ? raw : null;
}
