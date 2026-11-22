/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import enConnections from '../../../../../../messages/en/connections.json';
import enErrors from '../../../../../../messages/en/errors.json';
import faConnections from '../../../../../../messages/fa/connections.json';
import faErrors from '../../../../../../messages/fa/errors.json';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/actions/social', () => ({
  retryPublishJob: vi.fn(),
  cancelPublishJob: vi.fn(),
  reconnectSocialConnection: vi.fn(),
}));

const { PublishQueueSection } = await import('./PublishQueueSection');
const { PublishHistorySection } = await import('./PublishHistorySection');

const job = (lastError: string, over: Record<string, unknown> = {}) => ({
  id: 'j1',
  platform: 'LINKEDIN',
  status: 'FAILED',
  scheduledAtUtc: null,
  externalPostUrl: null,
  lastError,
  retryCount: 0,
  createdAt: '2026-11-20T10:00:00.000Z',
  publishedAtUtc: null,
  socialConnectionId: 'c1',
  connectionStatus: 'EXPIRED' as string | null,
  ...over,
});

function render(
  Section: typeof PublishQueueSection | typeof PublishHistorySection,
  jobs: ReturnType<typeof job>[],
  locale: 'en' | 'fa' = 'en',
) {
  const messages = locale === 'en' ? { ...enConnections, ...enErrors } : { ...faConnections, ...faErrors };
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages,
      timeZone: 'UTC',
      children: createElement(Section, { jobs, workspaceId: 'w1', onOpenAccounts: () => {}, onConnectNew: () => {}, onReconnectTelegram: () => {} }),
    }),
  );
}

describe.each([
  ['Publish Queue', PublishQueueSection],
  ['Publish History', PublishHistorySection],
] as const)('%s failure actions', (_name, Section) => {
  it('expired / revoked connection → Reconnect account', () => {
    expect(render(Section, [job('[CONNECTION_EXPIRED] LinkedIn 401')])).toContain('Reconnect account');
    expect(render(Section, [job('[CONNECTION_REVOKED] 403', { connectionStatus: 'REVOKED' })])).toContain('Reconnect account');
  });

  it('no connection → Connect an account', () => {
    expect(render(Section, [job('[NO_CONNECTION] gone', { connectionStatus: null })])).toContain('Connect an account');
  });

  it('already reconnected, or a content error → no account action', () => {
    for (const html of [
      render(Section, [job('[CONNECTION_EXPIRED] x', { connectionStatus: 'CONNECTED' })]),
      render(Section, [job('[INVALID_CONTENT] too long', { connectionStatus: 'CONNECTED' })]),
    ]) {
      expect(html).not.toContain('Reconnect account');
      expect(html).not.toContain('Connect an account');
    }
  });

  it('renders the Persian label', () => {
    expect(render(Section, [job('[CONNECTION_EXPIRED] x')], 'fa')).toContain('اتصال دوبارهٔ حساب');
  });
});
