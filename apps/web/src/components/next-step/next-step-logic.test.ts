import { describe, expect, it } from 'vitest';

import type { NextStep } from '@/lib/first-post/types';

import { barText, toButtonAction } from './next-step-logic';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

describe('toButtonAction', () => {
  it('drops the label and keeps only plain fields', () => {
    expect(toButtonAction({ kind: 'link', label: { key: 'x' }, href: '/growth/new' })).toEqual({ kind: 'link', href: '/growth/new' });
    expect(
      toButtonAction({ kind: 'link', label: { key: 'x' }, href: 'https://www.linkedin.com/feed/update/1', external: true }),
    ).toEqual({ kind: 'link', href: 'https://www.linkedin.com/feed/update/1', external: true });
    expect(toButtonAction({ kind: 'connectLinkedIn', label: { key: 'x' }, workspaceId: 'ws1' })).toEqual({
      kind: 'connectLinkedIn',
      workspaceId: 'ws1',
    });
    expect(
      toButtonAction({ kind: 'publishNow', label: { key: 'x' }, contentItemId: 'c1', href: '/growth/ws1?tab=first-post' }),
    ).toEqual({ kind: 'publishNow', contentItemId: 'c1', href: '/growth/ws1?tab=first-post' });
  });
});

describe('barText', () => {
  it('translates the counter with its numbers, the line, the why and the label', () => {
    const step: NextStep = {
      id: 'connectLinkedIn',
      counter: { n: 3, total: 4 },
      line: { key: 'nextStep.connectLinkedIn.line' },
      why: { key: 'nextStep.connectLinkedIn.why' },
      action: { kind: 'connectLinkedIn', label: { key: 'nextStep.connectLinkedIn.action' }, workspaceId: 'ws1' },
      busy: false,
    };
    expect(barText(step, t)).toEqual({
      counter: 'nextStep.counter(n=3,total=4)',
      line: 'nextStep.connectLinkedIn.line',
      why: 'nextStep.connectLinkedIn.why',
      label: 'nextStep.connectLinkedIn.action',
    });
  });

  it('has no counter, why or label on an open-mode wait-free step without them', () => {
    const step: NextStep = { id: 'writing', line: { key: 'nextStep.writing.line' }, busy: true };
    expect(barText(step, t)).toEqual({ counter: null, line: 'nextStep.writing.line', why: null, label: null });
  });

  it('passes journey values through', () => {
    const step: NextStep = {
      id: 'journey',
      line: { key: 'journey.steps.market.title', values: { charts: 2 } },
      busy: false,
    };
    expect(barText(step, t).line).toBe('journey.steps.market.title(charts=2)');
  });
});
