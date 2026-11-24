/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import enGrowth from '../../../../../../../../messages/en/growth.json';
import enTabs from '../../../../../../../../messages/en/tabs-a.json';
import faGrowth from '../../../../../../../../messages/fa/growth.json';
import faTabs from '../../../../../../../../messages/fa/tabs-a.json';
import type { FirstPostState, FirstPostViewProps } from '@/lib/first-post/types';

// The locale-aware navigation needs the Next router; a plain anchor is enough here.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: unknown; children: unknown; className?: string }) =>
    createElement('a', { href: JSON.stringify(href), className }, children as never),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/actions/first-post', () => ({
  startFirstPost: vi.fn(),
  getFirstPostState: vi.fn(),
  firstPostOtherAngle: vi.fn(),
  logFirstPostDraftEdit: vi.fn(),
}));
vi.mock('@/app/actions/publish-now', () => ({ publishNow: vi.fn(), schedulePublish: vi.fn(), getPublishProgress: vi.fn() }));
vi.mock('@/app/actions/next-step', () => ({ recordNextStepClick: vi.fn() }));
vi.mock('@/app/actions/growth-competitors', () => ({ setCompetitorDecision: vi.fn(), addManualCompetitor: vi.fn() }));
vi.mock('@/app/actions/social-connect', () => ({ getSocialConnectUrl: vi.fn() }));
vi.mock('@/app/actions/calendar', () => ({ updateContentAndSchedule: vi.fn() }));
vi.mock('@/app/actions/quality-gate', () => ({ recheckContentQuality: vi.fn() }));

const { FirstPostView } = await import('./FirstPostView');

const base: Omit<FirstPostViewProps, 'state'> = {
  workspaceId: 'ws_1',
  competitors: [
    {
      id: 'c1',
      name: 'Core Motion Clinic',
      domain: 'coremotion.example',
      userDecision: 'ACCEPTED',
      evidence: [{ id: 'e1', kind: 'citation', url: 'https://www.directory.example/physio' }],
      source: 'evidence',
    },
    { id: 'c2', name: 'PhysioNow', domain: 'physionow.example', userDecision: 'PENDING', evidence: [], source: 'initialGuess' },
  ],
  linkedIn: { connected: false },
  draft: { id: 'ci_1', content: 'Most people who stop physio…', topic: 'Week three', qualityVerdict: null },
  why: { matrixCharts: 4, matricesReady: true, keywordCompetitors: 2, gaps: 3, topGap: 'Recovery week by week' },
  otherAnglesUsed: 0,
};

const STATES: Record<string, FirstPostState> = {
  confirm: { phase: 'confirm', accepted: 1, suggestions: 2 },
  running: {
    phase: 'running',
    runId: 'fpr_ws_1_1',
    startedAt: '2026-11-23T10:00:00Z',
    current: 'keywords',
    done: [{ step: 'matrices', summary: { charts: 4, competitors: 2 } }],
  },
  failed: {
    phase: 'failed',
    runId: 'fpr_ws_1_1',
    done: [{ step: 'matrices', summary: { charts: 4, competitors: 2 } }],
    failed: 'keywords',
    errorKind: 'notEnoughCompetitorSignals',
    retriesLeft: 0,
  },
  draft: { phase: 'draft', contentItemId: 'ci_1', approved: true, linkedIn: { connected: false } },
  publishing: { phase: 'publishing', contentItemId: 'ci_1' },
  published: {
    phase: 'published',
    contentItemId: 'ci_1',
    url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
    publishedAtUtc: '2026-11-23T14:06:00Z',
  },
};

function render(state: FirstPostState, locale: 'en' | 'fa', extra: Partial<FirstPostViewProps> = {}) {
  const messages = locale === 'en' ? { ...enTabs, ...enGrowth } : { ...faTabs, ...faGrowth };
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages,
      timeZone: 'UTC',
      onError: (error: Error) => {
        throw error;
      },
      children: createElement(FirstPostView, { ...base, ...extra, state }),
    }),
  );
}

/** Visible text only, without the Latin data the fixtures carry (names, domains, hosts, the post). */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[A-Za-z][\w.:/-]*/g, ' ');
}

describe('FirstPostView renders every phase', () => {
  for (const [name, state] of Object.entries(STATES)) {
    for (const locale of ['en', 'fa'] as const) {
      it(`${name} in ${locale}, with no missing message`, () => {
        const html = render(state, locale);
        expect(html.length).toBeGreaterThan(0);
        if (locale === 'fa') expect(visibleText(html)).not.toMatch(/[0-9]/);
      });
    }
  }
});

describe('confirm', () => {
  it('ticks only the accepted row and shows one evidence line each', () => {
    const html = render(STATES.confirm, 'en');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('directory.example');
    expect(html).toContain('AI guess');
  });

  it('a row the user added says "Added by you" after a reload, in every locale', () => {
    const manual = {
      id: 'c3',
      name: 'Stride Physio',
      domain: 'stride.example',
      userDecision: 'ACCEPTED',
      evidence: [],
      source: 'manual' as const,
    };
    const html = render(STATES.confirm, 'en', { competitors: [...base.competitors, manual] });
    expect(html.match(/Added by you/g)).toHaveLength(1);
    expect(render(STATES.confirm, 'fa', { competitors: [manual] })).toContain(faTabs.tabsA.firstPost.confirm.addedByYou);
  });

  it('keeps "Write my first post" disabled below 2 ticks', () => {
    const html = render(STATES.confirm, 'en');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Write my first post/);
  });

  it('with fewer than 2 suggestions, leads with adding and offers writing your own', () => {
    const html = render(STATES.confirm, 'en', { competitors: [] });
    expect(html).toContain('Add the competitors you know');
    expect(html).toContain('id="first-post-add"');
    expect(html).toContain('Write my own instead');
  });
});

describe('run', () => {
  it('shows what the finished step found and announces the current one', () => {
    const html = render(STATES.running, 'en');
    expect(html).toContain('2 competitors placed on 4 charts.');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Now: Topic gaps');
  });

  it('writes the counts in Persian digits in fa', () => {
    const html = render(STATES.running, 'fa');
    expect(html).toContain('۲ رقیب روی ۴ نمودار');
    expect(html).toContain('در حال انجام: شکاف‌های موضوعی');
  });

  it('after a second failure offers writing your own instead of a retry', () => {
    const html = render(STATES.failed, 'en');
    expect(html).toContain('Topic gaps didn&#x27;t finish.');
    expect(html).not.toContain('>Try again<');
    expect(html).toContain('Write my own instead');
  });

  it('an unreadable website says so and points at Brand Memory, not a retry', () => {
    const failed = STATES.failed as Extract<FirstPostState, { phase: 'failed' }>;
    const html = render({ ...failed, done: [], failed: 'matrices', errorKind: 'needsBrandSummary', retriesLeft: 1 }, 'en');
    expect(html).toContain('We couldn&#x27;t read your website.');
    expect(html).toContain('Open Brand Memory');
    expect(html).toContain('tab=strategy');
    expect(html).not.toContain('>Try again<');
  });

  it('a first failure offers one retry', () => {
    const html = render({ ...(STATES.failed as Extract<FirstPostState, { phase: 'failed' }>), retriesLeft: 1 }, 'en');
    expect(html).toContain('>Try again<');
  });
});

describe('draft and publish', () => {
  it('shows the post, stored "why" facts and the not-connected status, with no button of its own', () => {
    const html = render(STATES.draft, 'en');
    expect(html).toContain('Most people who stop physio');
    expect(html).toContain('Recovery week by week');
    expect(html).toContain('Market map · 4 charts');
    expect(html).toContain('Connect LinkedIn to publish.');
    // The bar owns the action (CPO): no Connect or Publish button in the view.
    expect(html).not.toMatch(/<button[^>]*>[^<]*Connect LinkedIn/);
    expect(html).not.toContain('Publish now');
    expect(html).toContain('Schedule for later');
  });

  it('shows the account once LinkedIn is connected, still with no Publish button', () => {
    const html = render(
      { phase: 'draft', contentItemId: 'ci_1', approved: true, linkedIn: { connected: true, accountName: 'Sara Ahmadi' } },
      'en',
      { linkedIn: { connected: true, accountName: 'Sara Ahmadi' } },
    );
    expect(html).toContain('<bdi>Sara Ahmadi</bdi>');
    expect(html).not.toContain('Publish now');
    expect(html).toContain('Schedule for later');
  });

  it('says why the bar\'s Publish now was refused', () => {
    const connected = { connected: true as const, accountName: 'Sara Ahmadi' };
    const draft: FirstPostState = { phase: 'draft', contentItemId: 'ci_1', approved: false, linkedIn: connected };
    expect(render(draft, 'en', { linkedIn: connected, publishRefusal: 'gateBlocked' })).toContain(
      'The quality check held this post.',
    );
    expect(render(STATES.draft, 'en', { publishRefusal: 'noConnection' })).toContain('Nothing was scheduled.');
    // Connected since: the old "no connection" refusal is not shown.
    expect(render(draft, 'en', { linkedIn: connected, publishRefusal: 'noConnection' })).not.toContain(
      'Nothing was scheduled.',
    );
    expect(render(STATES.publishing, 'en', { publishRefusal: 'gateBlocked' })).not.toContain('quality check held');
  });

  it('hides Try another angle at the limit', () => {
    expect(render(STATES.draft, 'en')).toContain('Try another angle');
    expect(render(STATES.draft, 'en', { otherAnglesUsed: 3 })).not.toContain('Try another angle');
  });

  it('publishing shows the wait line, no edit controls', () => {
    const html = render(STATES.publishing, 'en');
    expect(html).toContain('Publishing to LinkedIn… under a minute');
    expect(html).not.toContain('>Edit<');
  });

  it('published links to the live post', () => {
    const html = render(STATES.published, 'en');
    expect(html).toContain('href="https://www.linkedin.com/feed/update/urn:li:share:1"');
    expect(html).toContain('Your workspace is fully open.');
  });

  it('published with an unsafe URL shows no link', () => {
    const html = render({ ...(STATES.published as Extract<FirstPostState, { phase: 'published' }>), url: 'javascript:alert(1)' }, 'en');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('LinkedIn didn&#x27;t send a link back.');
  });
});
