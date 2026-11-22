/**
 * Which social sign-in providers exist and which are switched on.
 *
 * A provider is enabled only when it is built AND both its client id and
 * secret are set and non-empty. Anything else is a 404 on the routes and no
 * button on the pages. Facebook is deliberately not here (spec §15).
 */

export type OAuthProviderId = 'google' | 'github';

/** Providers whose code exists. GitHub joins in phase 2. */
const IMPLEMENTED: ReadonlySet<OAuthProviderId> = new Set<OAuthProviderId>(['google']);

const ENV_KEYS: Record<OAuthProviderId, { id: string; secret: string }> = {
  google: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
  github: { id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' },
};

/** Prisma enum value for each provider. */
export const PROVIDER_ENUM = { google: 'GOOGLE', github: 'GITHUB' } as const;

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export function providerCredentials(provider: OAuthProviderId): ProviderCredentials | null {
  if (!IMPLEMENTED.has(provider)) return null;
  const keys = ENV_KEYS[provider];
  const clientId = process.env[keys.id]?.trim();
  const clientSecret = process.env[keys.secret]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function enabledProviders(): OAuthProviderId[] {
  return (Object.keys(ENV_KEYS) as OAuthProviderId[]).filter((p) => providerCredentials(p) !== null);
}

/**
 * The route segment as an enabled provider, or null (-> 404). Unknown names,
 * `facebook`, and providers without credentials all come back null.
 */
export function parseEnabledProvider(segment: unknown): OAuthProviderId | null {
  if (typeof segment !== 'string') return null;
  const match = (Object.keys(ENV_KEYS) as OAuthProviderId[]).find((p) => p === segment);
  if (!match) return null;
  return providerCredentials(match) ? match : null;
}

/** Link target for a "Continue with ..." button. Only non-empty options are sent. */
export function oauthStartHref(
  provider: OAuthProviderId,
  opts: { locale: string; cohort?: string; site?: string },
): string {
  const params = new URLSearchParams();
  if (opts.locale) params.set('locale', opts.locale);
  if (opts.cohort) params.set('cohort', opts.cohort);
  if (opts.site) params.set('site', opts.site);
  const query = params.toString();
  return `/api/auth/oauth/${provider}/start${query ? `?${query}` : ''}`;
}

/**
 * The public origin every redirect and the redirect_uri are built from.
 * Never the request origin (security review M5). Required in production;
 * localhost only elsewhere.
 */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXT_PUBLIC_APP_URL must be set: social sign-in builds its redirects from it.');
    }
    return 'http://localhost:3000';
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('NEXT_PUBLIC_APP_URL is not a valid URL.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL must be https in production.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('NEXT_PUBLIC_APP_URL must be http(s).');
  }
  return url.origin;
}

export function redirectUri(provider: OAuthProviderId): string {
  return `${appOrigin()}/api/auth/oauth/${provider}/callback`;
}
