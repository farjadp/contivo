/**
 * GET /api/auth/oauth/[provider]/callback
 *
 * Order matters and every step fails closed:
 *  1. open the transaction cookie (always deleted afterwards, success or not)
 *  2. state must match, constant-time
 *  3. claim the transaction id exactly once (any error = refuse)
 *  4. provider-reported error -> cancelled / provider_error (text never shown)
 *  5. exchange the code with the PKCE verifier and verify the id_token
 *  6. resolve the account (spec §5), mint the same session as password sign-in
 *
 * Nothing the provider returns is logged: no code, token, id_token or email.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { writeActivityLog } from '@/lib/activity-log';
import { isUserSuspended } from '@/lib/admin-state';
import { createSessionCookie } from '@/lib/auth';
import { ensureWelcomeCredits } from '@/lib/credits';
import { INTAKE_SITE_COOKIE, normalizeIntakeSite } from '@/lib/intake-site';
import { callerIp, consumeRateLimit } from '@/lib/rate-limit';

import { errorRedirect, hardenResponse, notFound, redirectTo, safeLocale, serverError } from './common';
import { OAuthFlowError } from './errors';
import { googleIdentityFromCode } from './google';
import { LOGIN_PER_IP, REGISTER_PER_IP } from './limits';
import { appOrigin, parseEnabledProvider, type OAuthProviderId } from './providers';
import { resolveIdentity, type ProviderIdentity } from './resolve';
import { openTx, txCookieName, txCookieOptions, type OAuthTx } from './tx';
import { claimTx, errorTag, pruneUsedTx } from './tx-used';

const INTAKE_SITE_MAX_AGE = 60 * 60 * 24; // same as rememberIntakeSite
const ANONYMOUS = 'oauth-anonymous';

function sameSecret(a: string, b: string): boolean {
  // Hash first so the compare is constant-time regardless of lengths.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

async function identityFromCode(provider: OAuthProviderId, tx: OAuthTx, code: string): Promise<ProviderIdentity> {
  switch (provider) {
    case 'google':
      return googleIdentityFromCode({ code, verifier: tx.verifier, nonce: tx.nonce });
    default:
      throw new OAuthFlowError('provider_error', 'provider_not_built');
  }
}

/**
 * Always clears the transaction cookie, whatever the outcome. `expires` as well
 * as `maxAge`: when Next merges this response with cookies set through
 * cookies() (the session), Max-Age=0 is dropped but Expires survives.
 */
function clearTx(response: NextResponse): NextResponse {
  response.cookies.set(txCookieName(), '', { ...txCookieOptions(), maxAge: 0, expires: new Date(0) });
  return response;
}

async function refusal(provider: OAuthProviderId, locale: string, error: OAuthFlowError): Promise<NextResponse> {
  console.warn('[oauth] refused', { provider, code: error.code, reason: error.reason });
  await writeActivityLog({
    userId: error.userId ?? ANONYMOUS,
    action: 'OAUTH_LOGIN_REFUSED',
    detail: { provider, reason: error.reason },
  });
  return errorRedirect(locale, error.code);
}

export async function handleCallback(request: NextRequest, providerSegment: string): Promise<NextResponse> {
  const provider = parseEnabledProvider(providerSegment);
  if (!provider) return notFound();

  const done = (response: NextResponse) => clearTx(hardenResponse(response));
  let locale = safeLocale(null);

  try {
    const params = request.nextUrl.searchParams;
    const tx = await openTx(request.cookies.get(txCookieName())?.value, provider);
    if (!tx) return done(errorRedirect(locale, 'invalid_state'));
    locale = safeLocale(tx.locale);

    const state = params.get('state');
    if (!state || !sameSecret(state, tx.state)) return done(errorRedirect(locale, 'invalid_state'));

    if (!(await claimTx(tx.jti, tx.exp))) return done(errorRedirect(locale, 'invalid_state'));
    await pruneUsedTx();

    // From here the transaction is genuine and spent: refusals are worth a log row.
    try {
      if (params.has('error')) {
        throw new OAuthFlowError(params.get('error') === 'access_denied' ? 'cancelled' : 'provider_error', 'provider_reported_error');
      }
      const code = params.get('code');
      if (!code) throw new OAuthFlowError('provider_error', 'no_code');

      const identity = await identityFromCode(provider, tx, code);

      const ip = await callerIp();
      const resolution = await resolveIdentity(
        identity,
        { cohort: tx.cohort },
        {
          isSuspended: isUserSuspended,
          beforeCreate: async () => {
            const hit = await consumeRateLimit(`register:ip:${ip}`, REGISTER_PER_IP.limit, REGISTER_PER_IP.windowMs);
            if (!hit.allowed) throw new OAuthFlowError('rate_limited', 'register_bucket');
          },
          beforeKnownSignIn: async () => {
            const hit = await consumeRateLimit(`login:ip:${ip}`, LOGIN_PER_IP.limit, LOGIN_PER_IP.windowMs);
            if (!hit.allowed) throw new OAuthFlowError('rate_limited', 'login_bucket');
          },
        },
      );

      const { user } = resolution;
      // Idempotent: grants only when the account has no ledger history.
      await ensureWelcomeCredits(user.id);

      // Role comes from the database row, never from the provider.
      await createSessionCookie({ userId: user.id, email: user.email, role: user.role });

      if (resolution.kind === 'created') {
        await writeActivityLog({
          userId: user.id,
          action: 'USER_SIGNED_UP',
          detail: { locale, cohort: tx.cohort, provider, method: 'oauth' },
        });
      } else {
        await writeActivityLog({
          userId: user.id,
          action: 'USER_SIGNED_IN',
          detail: { locale, provider, method: 'oauth' },
        });
      }

      const response = redirectTo(`/${locale}/${user.role === 'ADMIN' ? 'admin' : 'dashboard'}`);
      const site = normalizeIntakeSite(tx.site);
      if (site) {
        // Readable by client JS on purpose (lib/intake-site.ts reads it): not HttpOnly.
        response.cookies.set(INTAKE_SITE_COOKIE, site.url, {
          maxAge: INTAKE_SITE_MAX_AGE,
          path: '/',
          sameSite: 'lax',
          secure: appOrigin().startsWith('https:'),
        });
      }
      return done(response);
    } catch (error) {
      if (error instanceof OAuthFlowError) return done(await refusal(provider, locale, error));
      throw error;
    }
  } catch (error) {
    console.error('[oauth] callback failed', { provider }, errorTag(error));
    try {
      return done(errorRedirect(locale, 'provider_error'));
    } catch {
      return clearTx(serverError());
    }
  }
}

