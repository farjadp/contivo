/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

// next-intl's navigation needs Next's runtime; a plain anchor is enough to check hrefs.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

import en from '../../../messages/en/auth.json';
import fa from '../../../messages/fa/auth.json';
import itMsgs from '../../../messages/it/auth.json';
import es from '../../../messages/es/auth.json';
import he from '../../../messages/he/auth.json';
import { OAUTH_ERROR_CODES, type OAuthErrorCode } from '@/lib/oauth/errors';

import { OAuthErrorNotice } from './oauth-error-notice';
import { SocialSignIn, type SocialProvider } from './social-buttons';

const LOCALES = { en, fa, it: itMsgs, es, he } as const;
type Loc = keyof typeof LOCALES;

function render(node: React.ReactElement, locale: Loc = 'en') {
  const missing: string[] = [];
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: LOCALES[locale],
      timeZone: 'UTC',
      onError: (e: Error) => missing.push(e.message),
      children: node,
    }),
  );
  return { html, missing };
}

const google: SocialProvider = {
  id: 'google',
  href: '/api/auth/oauth/google/start?locale=en',
};
const github: SocialProvider = {
  id: 'github',
  href: '/api/auth/oauth/github/start?locale=en',
};

describe('SocialSignIn', () => {
  it('renders nothing when no provider is enabled', () => {
    expect(render(createElement(SocialSignIn, { providers: [] })).html).toBe('');
  });

  it('renders one link per provider, with the divider and the fine print', () => {
    const { html, missing } = render(createElement(SocialSignIn, { providers: [google] }));
    expect(missing).toEqual([]);
    expect(html).toContain('href="/api/auth/oauth/google/start?locale=en"');
    expect(html).toContain('Continue with Google');
    expect(html).not.toContain('GitHub');
    expect(html).toContain('or with email');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html.indexOf('Continue with Google')).toBeLessThan(html.indexOf('or with email'));
  });

  it('adding GitHub is just another entry in the list', () => {
    const { html } = render(createElement(SocialSignIn, { providers: [google, github] }));
    expect(html).toContain('Continue with GitHub');
    expect(html.indexOf('Continue with Google')).toBeLessThan(html.indexOf('Continue with GitHub'));
  });

  it('uses the native label per locale, provider name kept in Latin', () => {
    const labels: Record<Loc, string> = {
      en: 'Continue with Google',
      fa: 'ادامه با Google',
      it: 'Continua con Google',
      es: 'Continuar con Google',
      he: 'המשיכו עם Google',
    };
    for (const loc of Object.keys(labels) as Loc[]) {
      const { html, missing } = render(createElement(SocialSignIn, { providers: [google] }), loc);
      expect(missing).toEqual([]);
      expect(html).toContain(labels[loc]);
    }
  });

  it('puts the icon before the text in the DOM, so RTL locales mirror it', () => {
    const { html } = render(createElement(SocialSignIn, { providers: [google] }), 'fa');
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('ادامه با Google'));
  });
});

describe('OAuthErrorNotice', () => {
  it('renders nothing for a null code', () => {
    expect(render(createElement(OAuthErrorNotice, { code: null })).html).toBe('');
  });

  it('has copy for every code in every app locale', () => {
    for (const loc of Object.keys(LOCALES) as Loc[]) {
      for (const code of OAUTH_ERROR_CODES) {
        const { html, missing } = render(createElement(OAuthErrorNotice, { code }), loc);
        expect(missing, `${loc}/${code}`).toEqual([]);
        expect(html).toContain('role="alert"');
        expect(html).toContain(`data-oauth-error="${code}"`);
      }
    }
  });

  it('email_in_use says to sign in the old way, connect in Settings, or contact us', () => {
    const { html } = render(createElement(OAuthErrorNotice, { code: 'email_in_use' }));
    expect(html).toContain('An account with this email already exists');
    expect(html).toContain('sign in the way you did before');
    expect(html).toContain('connect the provider in Settings');
    expect(html).toContain('If you did not create it');
    expect(html).toContain('href="/contact"');
  });

  it('prints nothing for a value that skipped the page whitelist', () => {
    const forged = '<img src=x onerror=alert(1)>' as unknown as OAuthErrorCode;
    expect(render(createElement(OAuthErrorNotice, { code: forged })).html).toBe('');
  });
});
