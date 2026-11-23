import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}));
vi.mock('@/lib/connect-attempt', () => ({ clearConnectAttempt: vi.fn() }));

const { ChannelConnectedNotice } = await import('./ChannelConnectedNotice');

const props = {
  title: 'LinkedIn connected',
  body: 'Contivo can now publish to LinkedIn for you. Your first post is ready to go out.',
  actionLabel: 'Publish this post',
  actionHref: '/growth/w1?tab=pipeline',
  dismissHref: '/growth/w1',
  dismissLabel: 'Close',
};

describe('ChannelConnectedNotice', () => {
  it('open mode: one action button, "Publish this post", plus the close link', () => {
    const html = renderToStaticMarkup(createElement(ChannelConnectedNotice, props));
    expect(html).toContain('Publish this post');
    expect(html).toContain('href="/growth/w1?tab=pipeline"');
  });

  it('guided mode (compact, the bar\'s confirmation): no CTA of its own, only close', () => {
    const html = renderToStaticMarkup(createElement(ChannelConnectedNotice, { ...props, compact: true }));
    expect(html).not.toContain('Publish this post');
    expect(html).not.toContain('href="/growth/w1?tab=pipeline"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('aria-label="Close"');
  });
});
