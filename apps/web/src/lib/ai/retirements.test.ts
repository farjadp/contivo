import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_FALLBACK_MODEL } from '@/lib/app-settings';

import {
  DEFAULT_ANTHROPIC_JUDGE_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_SEARCH_MODEL,
} from './models';
import { resetRetirementWarnings, retirementStatus, warnIfRetiring } from './retirements';

beforeEach(() => {
  captureMessage.mockReset();
  resetRetirementWarnings();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('retirementStatus', () => {
  it('is ok far from the date, retiring inside 14 days, retired from the shutdown day', () => {
    expect(retirementStatus('gpt-5-mini', new Date('2026-11-20T00:00:00Z'))).toEqual({ status: 'ok' });
    expect(retirementStatus('gpt-5-mini', new Date('2026-11-30T00:00:00Z'))).toMatchObject({
      status: 'retiring',
      daysLeft: 11,
      replacement: 'gpt-6.1-terra',
    });
    expect(retirementStatus('gpt-5-mini', new Date('2026-12-11T00:00:00Z'))).toMatchObject({ status: 'retired' });
  });

  it('matches a dated snapshot to its model and ignores unlisted models', () => {
    expect(retirementStatus('gpt-5-mini-2025-08-07', new Date('2026-12-12T00:00:00Z')).status).toBe('retired');
    expect(retirementStatus('claude-sonnet-5-5', new Date('2030-01-01T00:00:00Z')).status).toBe('ok');
  });
});

describe('warnIfRetiring', () => {
  it('logs and raises Sentry once per model, fatal when retired', () => {
    const at = new Date('2026-12-12T00:00:00Z');
    warnIfRetiring('gpt-5-mini', at);
    warnIfRetiring('gpt-5-mini', at);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0][0]).toMatch(/gpt-5-mini RETIRED on 2026-12-11/);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ level: 'fatal' });
  });

  it('stays quiet for a healthy model', () => {
    warnIfRetiring('claude-opus-5-5');
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

// Deliberately tied to today's date: this fails CI 14 days before a default
// model shuts down, so the switch happens before customers see errors.
describe('default models are not about to shut down', () => {
  it.each([
    ['OPENAI_DEFAULT_MODEL', DEFAULT_OPENAI_MODEL],
    ['OPENAI_SEARCH_MODEL', DEFAULT_OPENAI_SEARCH_MODEL],
    ['admin OpenAI fallback', DEFAULT_OPENAI_FALLBACK_MODEL],
    ['ANTHROPIC_MODEL', DEFAULT_ANTHROPIC_MODEL],
    ['ANTHROPIC_MODEL_JUDGE', DEFAULT_ANTHROPIC_JUDGE_MODEL],
    ['admin Gemini model', DEFAULT_GEMINI_MODEL],
  ])('%s (%s)', (_name, model) => {
    expect(retirementStatus(model)).toEqual({ status: 'ok' });
  });
});
