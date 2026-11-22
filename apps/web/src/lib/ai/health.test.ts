import { describe, expect, it } from 'vitest';

import { CRITICAL_COOLDOWN_MS, ProviderHealth, RATE_LIMIT_COOLDOWN_CAP_MS } from './health';

describe('ProviderHealth', () => {
  it('rate limit cool-down = retry-after capped at 60 s', () => {
    let now = 0;
    const health = new ProviderHealth(() => now);
    health.recordFailure('openai', 'rate_limit', 600_000);
    expect(health.view('openai').coolingDownUntil?.getTime()).toBe(RATE_LIMIT_COOLDOWN_CAP_MS);
    now = RATE_LIMIT_COOLDOWN_CAP_MS + 1;
    expect(health.isAvailable('openai')).toBe(true);
  });

  it('only one probe at a time after a cool-down ends', () => {
    let now = 0;
    const health = new ProviderHealth(() => now);
    health.recordFailure('openai', 'billing');
    now = CRITICAL_COOLDOWN_MS + 1;
    expect(health.claim('openai')).toBe(true); // the probe
    expect(health.claim('openai')).toBe(false); // others skip while it runs
    health.recordFailure('openai', 'billing'); // probe failed → new 15 min
    expect(health.view('openai').coolingDownUntil?.getTime()).toBe(now + CRITICAL_COOLDOWN_MS);
    now += CRITICAL_COOLDOWN_MS + 1;
    expect(health.claim('openai')).toBe(true);
    expect(health.recordReachable('openai')).toEqual({ provider: 'openai', change: 'recovered', coolingDownUntil: null });
    expect(health.claim('openai')).toBe(true);
    expect(health.claim('openai')).toBe(true); // healthy: no probe gating
  });

  it('a 400 / invalid output on a probe ends the cool-down (the provider answered)', () => {
    let now = 0;
    const health = new ProviderHealth(() => now);
    health.recordFailure('gemini', 'auth');
    now = CRITICAL_COOLDOWN_MS + 1;
    health.claim('gemini');
    expect(health.recordFailure('gemini', 'bad_request')?.change).toBe('recovered');
    expect(health.view('gemini')).toMatchObject({ healthy: true, lastErrorClass: 'bad_request' });
  });

  it('restore from a DB event keeps the remaining 15-min window and never shortens one', () => {
    const now = 10 * 60_000;
    const health = new ProviderHealth(() => now);
    health.restore('openai', 'billing', new Date(now - 5 * 60_000));
    expect(health.view('openai').coolingDownUntil?.getTime()).toBe(now + 10 * 60_000);
    health.restore('openai', 'auth', new Date(now - 14 * 60_000));
    expect(health.view('openai').reason).toBe('billing');
    health.restore('anthropic', 'billing', new Date(now - 16 * 60_000)); // expired
    expect(health.view('anthropic').healthy).toBe(true);
  });
});
