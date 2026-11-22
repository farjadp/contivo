import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response('intl', { headers: { 'x-handled-by': 'intl' } }),
}));

import proxy from './proxy';
import { isRtl, isSiteOnly, locales, SITE_NAMESPACES } from './i18n/routing';

const req = (path: string) => new NextRequest(new URL(path, 'https://www.contivo.app'));

describe('site-only locales', () => {
  it('sends their app routes to the English app, keeping the rest of the path and query', () => {
    for (const [from, to] of [
      ['/fr/dashboard', '/en/dashboard'],
      ['/ar/growth/abc?tab=strategy', '/en/growth/abc?tab=strategy'],
            ['/zh/onboarding', '/en/onboarding'],
    ]) {
      const res = proxy(req(from));
      expect(res.status, from).toBe(307);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname + loc.search, from).toBe(to);
    }
  });

  it('leaves their public site and sign-up to the locale middleware', () => {
    for (const path of ['/fr', '/ar/pricing', '/ar/sign-up', '/zh/compare']) {
      expect(proxy(req(path)).headers.get('x-handled-by'), path).toBe('intl');
    }
  });

  it('never redirects the full locales', () => {
    for (const path of ['/fa/dashboard', '/it/growth/abc', '/en/settings', '/es/dashboard', '/he/connections']) {
      expect(proxy(req(path)).headers.get('x-handled-by'), path).toBe('intl');
    }
  });

  it('marks fr, ar and zh site-only, and Arabic right-to-left', () => {
    expect(locales.filter(isSiteOnly)).toEqual(['fr', 'ar', 'zh']);
    expect(locales.filter(isRtl)).toEqual(['fa', 'he', 'ar']);
    expect(SITE_NAMESPACES.has('auth')).toBe(true);
    expect(SITE_NAMESPACES.has('dashboard')).toBe(false);
  });
});
