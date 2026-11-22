/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import enErrors from '../../../../../../../messages/en/errors.json';
import enTabs from '../../../../../../../messages/en/tabs-a.json';
import faErrors from '../../../../../../../messages/fa/errors.json';
import faTabs from '../../../../../../../messages/fa/tabs-a.json';

const en = { ...enTabs, ...enErrors };
const fa = { ...faTabs, ...faErrors };
import type { PublishOutcome } from '@/lib/publish-outcome';

// The locale-aware Link needs the Next router; a plain anchor shows the href we build.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: { pathname: string; query: Record<string, string> }; children: unknown; className?: string }) =>
    createElement('a', { href: `${href.pathname}?${new URLSearchParams(href.query).toString()}`, className }, children as never),
}));

const { PublishOutcomeNotice } = await import('./PublishOutcomeNotice');

function render(outcome: PublishOutcome, locale: 'en' | 'fa' = 'en') {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: locale === 'en' ? en : fa,
      timeZone: 'UTC',
      children: createElement(PublishOutcomeNotice, { outcome, workspaceId: 'ws_1' }),
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

  it('shows a localised headline for the code, the English detail below, and sends an expired connection to Connections', () => {
    const html = render({
      kind: 'failed',
      code: 'CONNECTION_EXPIRED',
      detail: 'LinkedIn rejected the access token (401).',
      action: { action: 'reconnect', tab: 'social' },
      platform: 'LINKEDIN',
    });
    expect(html).toContain('The connection to this account has expired.');
    expect(html).toContain('LinkedIn rejected the access token (401).');
    expect(html).toContain('Reconnect in Connections');
    expect(html).toContain('href="/connections?tab=social&amp;workspaceId=ws_1"');
  });

  it('sends NO_SITE to the Websites tab', () => {
    const html = render({
      kind: 'failed',
      code: 'NO_SITE',
      detail: 'No active site connection for this workspace.',
      action: { action: 'connect', tab: 'websites' },
      platform: null,
    });
    expect(html).toContain('tab=websites');
    expect(html).toContain('Open Connections');
  });

  it('shows an old uncoded reason as it is', () => {
    const html = render({ kind: 'failed', code: null, detail: 'Something broke', action: null, platform: 'X' });
    expect(html).toContain('Something broke');
    expect(html).not.toContain('/connections');
  });

  it('offers no action when the failure is not about the connection', () => {
    const html = render({ kind: 'failed', code: null, detail: null, action: null, platform: 'X' });
    expect(html).toContain('No reason was recorded.');
    expect(html).not.toContain('/connections');
  });

  it('writes the failure headline in Persian', () => {
    const html = render(
      { kind: 'failed', code: 'RATE_LIMITED', detail: 'HTTP 429 from X', action: null, platform: 'X' },
      'fa',
    );
    expect(html).toContain('پلتفرم درخواست‌ها را محدود کرد');
    expect(html).toContain('HTTP 429 from X');
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
