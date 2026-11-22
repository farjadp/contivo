/**
 * intake-site.ts — carries the address typed into the home page hero through
 * sign-up to the first workspace form.
 *
 * The hero sends `?site=` to /sign-up. Sign-up shows it back and keeps it in a
 * short-lived first-party cookie, because registering redirects through
 * /dashboard and /onboarding, which drop the query string. /growth/new reads
 * the cookie and fills its address field. Nothing server-side trusts it: it is
 * only ever a default value the user can see and change.
 */

export const INTAKE_SITE_COOKIE = 'contivo_intake_site';
const MAX_AGE_SECONDS = 60 * 60 * 24;
const MAX_LENGTH = 200;

export interface IntakeSite {
  /** What goes into the address field: always with a scheme. */
  url: string;
  /** What the person is shown: the bare host. */
  host: string;
}

/** Same rule as the hero: a host with a dot, scheme optional. */
export function normalizeIntakeSite(raw: unknown): IntakeSite | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.replace(/^www\./i, '');
    if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return { url: `${parsed.protocol}//${parsed.hostname}${path}`, host };
  } catch {
    return null;
  }
}

/** Browser only. Silently does nothing where cookies are blocked. */
export function rememberIntakeSite(site: IntakeSite): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${INTAKE_SITE_COOKIE}=${encodeURIComponent(site.url)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

/** Browser only. Returns null when there is nothing valid to prefill. */
export function readIntakeSite(): IntakeSite | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((c) => c.startsWith(`${INTAKE_SITE_COOKIE}=`));
  if (!entry) return null;
  try {
    return normalizeIntakeSite(decodeURIComponent(entry.slice(INTAKE_SITE_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

/** Browser only. Called once the address has been used for a workspace. */
export function forgetIntakeSite(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${INTAKE_SITE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
