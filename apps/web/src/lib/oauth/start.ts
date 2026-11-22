/**
 * GET /api/auth/oauth/[provider]/start
 *
 * Validates what the page sent (invalid values are dropped, never an error),
 * seals the transaction into the encrypted cookie and sends the browser to the
 * provider. Used for both sign-in and sign-up: a provider cannot tell them apart.
 */

import type { NextRequest, NextResponse } from 'next/server';

import { normalizeIntakeSite } from '@/lib/intake-site';
import { callerIp, consumeRateLimit } from '@/lib/rate-limit';
import { allowedCohort } from '@/lib/signup-cohort';

import { errorRedirect, notFound, redirectAbsolute, safeLocale, serverError } from './common';
import { googleAuthorizationUrl } from './google';
import { parseEnabledProvider, type OAuthProviderId } from './providers';
import { errorTag } from './tx-used';
import { randomToken, sealTx, TX_TTL_SECONDS, txCookieName, txCookieOptions } from './tx';

const START_PER_IP = { limit: 30, windowMs: 15 * 60_000 };

function authorizationUrl(provider: OAuthProviderId, input: { state: string; verifier: string; nonce: string }): URL {
  switch (provider) {
    case 'google':
      return googleAuthorizationUrl(input);
    default:
      // Unreachable while parseEnabledProvider only returns built providers.
      throw new Error(`No authorization builder for ${provider}`);
  }
}

export async function handleStart(request: NextRequest, providerSegment: string): Promise<NextResponse> {
  const provider = parseEnabledProvider(providerSegment);
  if (!provider) return notFound();

  const params = request.nextUrl.searchParams;
  const locale = safeLocale(params.get('locale'));

  try {
    const ip = await callerIp();
    const limit = await consumeRateLimit(`oauth:start:ip:${ip}`, START_PER_IP.limit, START_PER_IP.windowMs);
    if (!limit.allowed) return errorRedirect(locale, 'rate_limited');

    const cohort = allowedCohort(params.get('cohort'));
    const site = normalizeIntakeSite(params.get('site'))?.url ?? null;

    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();

    const url = authorizationUrl(provider, { state, verifier, nonce });
    const sealed = await sealTx({ provider, state, verifier, nonce, locale, cohort, site });

    const response = redirectAbsolute(url);
    response.cookies.set(txCookieName(), sealed, { ...txCookieOptions(), maxAge: TX_TTL_SECONDS });
    return response;
  } catch (error) {
    // Misconfiguration (missing NEXT_PUBLIC_APP_URL / JWT_SECRET) lands here: say so in the log.
    console.error('[oauth] start failed', { provider }, errorTag(error), (error as Error)?.message?.slice(0, 200));
    try {
      return errorRedirect(locale, 'provider_error');
    } catch {
      // Not even our own origin could be resolved: nothing safe to redirect to.
      return serverError();
    }
  }
}
