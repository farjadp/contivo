import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../../../../messages/en/tabs-a.json';
import fa from '../../../../../../../messages/fa/tabs-a.json';
import type { PublishOutcome } from '@/lib/publish-outcome';

// The locale-aware Link needs the Next router; a plain anchor shows the href we build.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: { pathname: string; query: Record<string, string> }; children: unknown; className?: string }) =>
    createElement('a', { href: `${href.pathname}?${new URLSearchParams(href.query).toString()}`, className }, children as never),
}));

const { PublishOutcomeNotice } = await import('./PublishOutcomeNotice');

function render(outcome: PublishOutcome, locale: 'en' | 'fa' = 'en', channel = 'linkedin') {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: locale === 'en' ? en : fa,
      timeZone: 'UTC',
      children: createElement(PublishOutcomeNotice, { outcome, channel, workspaceId: 'ws_1' }),
    }),
  );
}

describe('PublishOutcomeNotice', () => {
  it('links to the live post', () => {
    const html = render({
      kind: 'published',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
      platform: 'LINKEDIN',
      publishedAtUtc: '2026-11-20T10:00:00.000Z',
    });
    expect(html).toContain('Published on <bdi>LinkedIn</bdi>');
    expect(html).toContain('href="https://www.linkedin.com/feed/update/urn:li:share:1"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows the reason and sends an expired connection to Connections', () => {
    const html = render({ kind: 'failed', reason: 'Token revoked by LinkedIn', action: 'reconnect', platform: 'LINKEDIN' });
    expect(html).toContain('Token revoked by LinkedIn');
    expect(html).toContain('Reconnect in Connections');
    expect(html).toContain('href="/connections?tab=social&amp;workspaceId=ws_1"');
  });

  it('sends a blog post with no site connection to the Websites tab', () => {
    const html = render(
      { kind: 'failed', reason: 'No active site connection for this workspace.', action: 'connect', platform: null },
      'en',
      'blog',
    );
    expect(html).toContain('tab=websites');
    expect(html).toContain('Open Connections');
  });

  it('offers no action when the failure is not about the connection', () => {
    const html = render({ kind: 'failed', reason: null, action: null, platform: 'X' });
    expect(html).toContain('No reason was recorded.');
    expect(html).not.toContain('/connections');
  });

  it('renders Persian with Persian digits in the date', () => {
    const html = render(
      { kind: 'published', url: null, platform: 'LINKEDIN', publishedAtUtc: '2026-11-20T10:00:00.000Z' },
      'fa',
    );
    expect(html).toContain('در <bdi>LinkedIn</bdi> منتشر شد');
    expect(html).toContain('پلتفرم پیوندی به پست برنگرداند.');
    // Persian calendar and digits: 20 Nov 2026 is 29 Aban 1405.
    expect(html).toContain('۲۹ آبان ۱۴۰۵');
    expect(html).not.toContain('2026');
  });
});
