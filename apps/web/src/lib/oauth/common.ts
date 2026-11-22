import { NextResponse } from 'next/server';

import { defaultLocale, locales } from '@/i18n/routing';

import type { OAuthErrorCode } from './errors';
import { appOrigin } from './providers';

/** The validated locale, or the default. The only locale ever used in a redirect. */
export function safeLocale(raw: unknown): string {
  return typeof raw === 'string' && (locales as readonly string[]).includes(raw) ? raw : defaultLocale;
}

/** Headers every start/callback response carries. */
export function hardenResponse<T extends NextResponse>(response: T): T {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

/** 302 to a path on our own origin (never the request's). */
export function redirectTo(path: string): NextResponse {
  return hardenResponse(NextResponse.redirect(new URL(path, appOrigin()), 302));
}

export function errorRedirect(locale: string, code: OAuthErrorCode): NextResponse {
  return redirectTo(`/${safeLocale(locale)}/sign-in?error=${code}`);
}

export function notFound(): NextResponse {
  return hardenResponse(new NextResponse(null, { status: 404 }));
}

/** 302 to an absolute URL we built ourselves (the provider's authorization URL). */
export function redirectAbsolute(url: URL): NextResponse {
  return hardenResponse(NextResponse.redirect(url, 302));
}

export function serverError(): NextResponse {
  return hardenResponse(new NextResponse(null, { status: 500 }));
}
