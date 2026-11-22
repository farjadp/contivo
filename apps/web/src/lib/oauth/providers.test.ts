import { afterEach, describe, expect, it, vi } from 'vitest';

import { appOrigin, enabledProviders, oauthStartHref, parseEnabledProvider, redirectUri } from './providers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enabledProviders', () => {
  it('is empty without credentials', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect(enabledProviders()).toEqual([]);
  });

  it('needs BOTH the id and the secret, non-empty', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '   ');
    expect(enabledProviders()).toEqual([]);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    expect(enabledProviders()).toEqual(['google']);
  });

  it('never returns github in phase 1, even with credentials set', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', 'id');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'secret');
    expect(enabledProviders()).not.toContain('github');
    expect(parseEnabledProvider('github')).toBeNull();
  });
});

describe('parseEnabledProvider', () => {
  it('404s unknown names, facebook, and providers without env', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    expect(parseEnabledProvider('google')).toBe('google');
    expect(parseEnabledProvider('facebook')).toBeNull();
    expect(parseEnabledProvider('Google')).toBeNull();
    expect(parseEnabledProvider('')).toBeNull();
    expect(parseEnabledProvider(undefined)).toBeNull();
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect(parseEnabledProvider('google')).toBeNull();
  });
});

describe('oauthStartHref', () => {
  it('encodes values and sends only non-empty ones', () => {
    expect(oauthStartHref('google', { locale: 'fa' })).toBe('/api/auth/oauth/google/start?locale=fa');
    expect(oauthStartHref('google', { locale: 'en', cohort: 'mentee-nov26', site: 'https://a.com/x?y=1&z=2' })).toBe(
      '/api/auth/oauth/google/start?locale=en&cohort=mentee-nov26&site=https%3A%2F%2Fa.com%2Fx%3Fy%3D1%26z%3D2',
    );
    expect(oauthStartHref('google', { locale: 'en', cohort: '', site: undefined })).toBe(
      '/api/auth/oauth/google/start?locale=en',
    );
  });
});

describe('appOrigin', () => {
  it('requires NEXT_PUBLIC_APP_URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(() => appOrigin()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it('refuses a non-https or malformed production value', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://www.contivo.app');
    expect(() => appOrigin()).toThrow(/https/);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'not a url');
    expect(() => appOrigin()).toThrow(/valid URL/);
  });

  it('defaults to localhost only outside production, and strips paths', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(appOrigin()).toBe('http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.contivo.app/some/path/');
    expect(appOrigin()).toBe('https://www.contivo.app');
    expect(redirectUri('google')).toBe('https://www.contivo.app/api/auth/oauth/google/callback');
  });
});
