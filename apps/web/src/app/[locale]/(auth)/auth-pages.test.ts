import { afterEach, describe, expect, it, vi } from 'vitest';

// The client forms pull in server actions (Prisma etc.). These tests are about
// what the server wrappers hand them, so the forms are stubs.
vi.mock('./sign-in/SignInForm', () => ({ SignInForm: () => null }));
vi.mock('./sign-up/SignUpForm', () => ({ SignUpForm: () => null }));

import SignInPage from './sign-in/page';
import SignUpPage from './sign-up/page';

type Element = { props: Record<string, unknown> };
const params = (locale = 'en') => Promise.resolve({ locale });

function enableGoogle() {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'placeholder-client-id');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'placeholder-client-secret');
}

afterEach(() => vi.unstubAllEnvs());

describe('SignInPage wrapper', () => {
  it('passes no providers when none are configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const el = (await SignInPage({ params: params(), searchParams: Promise.resolve({}) })) as unknown as Element;
    expect(el.props.providers).toEqual([]);
    expect(el.props.errorCode).toBeNull();
  });

  it('passes the enabled list with locale-only hrefs (no cohort, no site)', async () => {
    enableGoogle();
    const el = (await SignInPage({
      params: params('fa'),
      // Even if these were on the URL, sign-in must not forward them.
      searchParams: Promise.resolve({ cohort: 'x', site: 'example.com' } as never),
    })) as unknown as Element;
    expect(el.props.providers).toEqual([{ id: 'google', href: '/api/auth/oauth/google/start?locale=fa' }]);
  });

  it('maps a known code and drops a forged one', async () => {
    const known = (await SignInPage({
      params: params(),
      searchParams: Promise.resolve({ error: 'email_in_use' }),
    })) as unknown as Element;
    expect(known.props.errorCode).toBe('email_in_use');

    for (const error of ['<script>alert(1)</script>', 'access_denied', ['cancelled'], 'CANCELLED']) {
      const el = (await SignInPage({
        params: params(),
        searchParams: Promise.resolve({ error } as never),
      })) as unknown as Element;
      expect(el.props.errorCode, JSON.stringify(error)).toBeNull();
    }
  });
});

describe('SignUpPage wrapper', () => {
  it('carries cohort and site (normalised) on the provider hrefs', async () => {
    enableGoogle();
    const el = (await SignUpPage({
      params: params(),
      searchParams: Promise.resolve({ cohort: 'spring-26', site: 'www.example.com/shop' }),
    })) as unknown as Element;
    const [{ href }] = el.props.providers as { id: string; href: string }[];
    const url = new URL(href, 'https://x.test');
    expect(url.pathname).toBe('/api/auth/oauth/google/start');
    expect(url.searchParams.get('locale')).toBe('en');
    expect(url.searchParams.get('cohort')).toBe('spring-26');
    expect(url.searchParams.get('site')).toBe('https://www.example.com/shop');
    expect(el.props.cohort).toBe('spring-26');
  });

  it('omits cohort and site when absent or invalid', async () => {
    enableGoogle();
    const el = (await SignUpPage({
      params: params('he'),
      searchParams: Promise.resolve({ site: 'not a site' }),
    })) as unknown as Element;
    expect(el.props.providers).toEqual([{ id: 'google', href: '/api/auth/oauth/google/start?locale=he' }]);
    expect(el.props.site).toBeNull();
  });

  it('passes no providers when none are configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const el = (await SignUpPage({ params: params(), searchParams: Promise.resolve({}) })) as unknown as Element;
    expect(el.props.providers).toEqual([]);
  });
});
