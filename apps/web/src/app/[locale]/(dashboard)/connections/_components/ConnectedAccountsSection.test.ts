/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../../../messages/en/connections.json';
import fa from '../../../../../../messages/fa/connections.json';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/actions/social', () => ({
  disconnectSocialConnection: vi.fn(),
  setDefaultConnection: vi.fn(),
  reconnectSocialConnection: vi.fn(),
}));

const { ConnectedAccountsSection } = await import('./ConnectedAccountsSection');

const account = (platform: string, status: string) => ({
  id: `${platform}-${status}`,
  platform,
  accountName: 'Sara Ahmadi',
  accountIdentifier: 'urn:li:person:1',
  status,
  isDefault: false,
  lastSyncAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
});

function render(accounts: ReturnType<typeof account>[], locale: 'en' | 'fa' = 'en') {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: locale === 'en' ? en : fa,
      timeZone: 'UTC',
      children: createElement(ConnectedAccountsSection, { accounts, workspaceId: 'ws_1', onConnectNew: () => {} }),
    }),
  );
}

describe('ConnectedAccountsSection', () => {
  it('offers Reconnect, with an explanation, for expired, revoked and re-auth connections', () => {
    for (const [status, label, hint] of [
      ['EXPIRED', 'Expired', 'sign-in has expired'],
      ['REVOKED', 'Revoked', 'was withdrawn'],
      ['PENDING_REAUTH', 'Needs re-auth', 'sign in again'],
    ] as const) {
      const html = render([account('LINKEDIN', status)]);
      expect(html).toContain(label);
      expect(html).toContain(hint);
      expect(html).toContain('>Reconnect<');
    }
  });

  it('shows neither hint nor Reconnect on a healthy connection', () => {
    const html = render([account('LINKEDIN', 'CONNECTED')]);
    expect(html).toContain('Connected');
    expect(html).not.toContain('>Reconnect<');
    expect(html).not.toContain('sign-in has expired');
  });

  it('does not offer a Reconnect that has no connect flow behind it', () => {
    const html = render([account('INSTAGRAM', 'REVOKED')]);
    expect(html).not.toContain('>Reconnect<');
    expect(html).toContain('cannot be reconnected from this page yet');
  });

  it('renders the Persian copy', () => {
    const html = render([account('X', 'EXPIRED')], 'fa');
    expect(html).toContain('ورود شما به <bdi>X</bdi> منقضی شده است.');
    expect(html).toContain('>اتصال دوباره<');
  });
});
