import { describe, expect, it } from 'vitest';

import { routing } from '@/i18n/routing';
import { connectReturnHref, connectedNextAction, parseConnectedPlatform } from './connect-return';
import type { JourneyStep } from './workspace-journey';

const step = (id: JourneyStep['id']): JourneyStep => ({
  id,
  order: 1,
  title: { key: `steps.${id}.title` },
  why: { key: `steps.${id}.why` },
  href: `/growth/w1?tab=${id}`,
  action: { key: `steps.${id}.action` },
  state: 'current',
  detail: { key: `steps.${id}.detail` },
});

describe('parseConnectedPlatform', () => {
  it('accepts the OAuth platforms', () => {
    expect(parseConnectedPlatform('linkedin')).toBe('linkedin');
    expect(parseConnectedPlatform(['x', 'linkedin'])).toBe('x');
  });

  it('drops anything else', () => {
    expect(parseConnectedPlatform('<script>')).toBeNull();
    expect(parseConnectedPlatform('toString')).toBeNull();
    expect(parseConnectedPlatform(undefined)).toBeNull();
  });
});

describe('connectReturnHref', () => {
  it('targets a real route template, not a hand-written path', () => {
    const href = connectReturnHref('w1', 'linkedin');
    expect(Object.keys(routing.pathnames ?? {})).toContain(href.pathname);
    expect(href).toEqual({ pathname: '/growth/[id]', params: { id: 'w1' }, query: { connected: 'linkedin' } });
  });
});

describe('connectedNextAction', () => {
  it('sends a workspace with nothing published to write its first post', () => {
    expect(connectedNextAction('w1', { next: step('market') }, 0)).toEqual({
      kind: 'firstPost',
      href: '/growth/w1?tab=pipeline&write=1',
    });
  });

  it('continues the setup chain once something is published', () => {
    const next = step('autopilot');
    expect(connectedNextAction('w1', { next }, 3)).toEqual({ kind: 'journey', step: next });
  });

  it('never points back at the connect step it just finished', () => {
    expect(connectedNextAction('w1', { next: step('channel') }, 2)).toEqual({
      kind: 'pipeline',
      href: '/growth/w1?tab=pipeline',
    });
  });

  it('falls back to the pipeline when setup is complete', () => {
    expect(connectedNextAction('w1', { next: null }, 2).kind).toBe('pipeline');
  });

  it('opens the first-post draft when one is waiting and nothing is published', () => {
    expect(connectedNextAction('w1', { next: step('market') }, 0, 'ci1')).toEqual({
      kind: 'firstPostDraft',
      href: '/growth/w1?tab=first-post',
    });
  });

  it('keeps the #69 behaviour when there is no first-post draft', () => {
    expect(connectedNextAction('w1', { next: step('market') }, 0, null)).toEqual(
      connectedNextAction('w1', { next: step('market') }, 0),
    );
  });

  it('ignores a draft id once something is published', () => {
    const next = step('autopilot');
    expect(connectedNextAction('w1', { next }, 1, 'ci1')).toEqual({ kind: 'journey', step: next });
    expect(connectedNextAction('w1', { next: null }, 1, 'ci1').kind).toBe('pipeline');
  });
});
