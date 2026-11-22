import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { fixtureHeaders, loadFixture } from './__fixtures__/load';
import {
  classifyAnthropic,
  classifyGemini,
  classifyOpenAi,
  classifyThrown,
  parseRetryAfter,
  sanitizeAiMessage,
} from './errors';

function openAi(name: string) {
  const f = loadFixture(name);
  return classifyOpenAi(f.status, JSON.stringify(f.body), fixtureHeaders(f));
}

function gemini(name: string) {
  const f = loadFixture(name);
  return classifyGemini(f.status, JSON.stringify(f.body));
}

/** Build the SDK's own typed error from a fixture body, the way the SDK does on a non-2xx. */
function anthropic(name: string) {
  const f = loadFixture(name);
  return classifyAnthropic(Anthropic.APIError.generate(f.status, f.body as object, undefined, fixtureHeaders(f)));
}

describe('classifyOpenAi', () => {
  it('recorded 429 insufficient_quota (credit_balance_exhausted) is billing, not a rate limit', () => {
    const e = openAi('openai-429-insufficient-quota.json');
    expect(e.errorClass).toBe('billing');
    expect(e.status).toBe(429);
  });

  it('recorded 401 invalid key is auth', () => {
    expect(openAi('openai-401-invalid-key.json').errorClass).toBe('auth');
  });

  it('429 rate_limit_exceeded is rate_limit with retry-after-ms', () => {
    const e = openAi('openai-429-rate-limit.json');
    expect(e.errorClass).toBe('rate_limit');
    expect(e.retryAfterMs).toBe(1400);
  });

  it('404 model_not_found is model_gone, 500 server, 400 bad_request', () => {
    expect(openAi('openai-404-model.json').errorClass).toBe('model_gone');
    expect(openAi('openai-500-server.json').errorClass).toBe('server');
    expect(openAi('openai-400-bad-request.json').errorClass).toBe('bad_request');
    expect(classifyOpenAi(503, '').errorClass).toBe('overloaded');
  });
});

describe('classifyGemini', () => {
  it('recorded 400 API_KEY_INVALID is auth, not bad_request', () => {
    expect(gemini('gemini-400-invalid-key.json').errorClass).toBe('auth');
  });

  it('recorded 404 unknown model is model_gone', () => {
    expect(gemini('gemini-404-model-not-found.json').errorClass).toBe('model_gone');
  });

  it('recorded 400 additionalProperties rejection is bad_request', () => {
    expect(gemini('gemini-400-additional-properties.json').errorClass).toBe('bad_request');
  });

  it('429 per-minute quota is rate_limit with the RetryInfo delay', () => {
    const e = gemini('gemini-429-per-minute.json');
    expect(e.errorClass).toBe('rate_limit');
    expect(e.retryAfterMs).toBe(37_000);
  });

  it('429 per-day quota (same message text) is billing', () => {
    expect(gemini('gemini-429-per-day.json').errorClass).toBe('billing');
  });

  it('403 billing disabled is billing, other 403 auth, 503 overloaded', () => {
    expect(classifyGemini(403, JSON.stringify({ error: { message: 'Billing is disabled for this project' } })).errorClass).toBe('billing');
    expect(classifyGemini(403, JSON.stringify({ error: { message: 'Permission denied' } })).errorClass).toBe('auth');
    expect(gemini('gemini-503-overloaded.json').errorClass).toBe('overloaded');
  });
});

describe('classifyAnthropic', () => {
  it('recorded 401 invalid x-api-key is auth', () => {
    const e = anthropic('anthropic-401-invalid-key.json');
    expect(e.errorClass).toBe('auth');
    expect(e.status).toBe(401);
  });

  it('400 "credit balance is too low" is billing; plain 400 is bad_request', () => {
    expect(anthropic('anthropic-400-credit-balance.json').errorClass).toBe('billing');
    expect(anthropic('anthropic-400-bad-request.json').errorClass).toBe('bad_request');
  });

  it('402 billing_error and the 429 spend cap are billing', () => {
    expect(anthropic('anthropic-402-billing.json').errorClass).toBe('billing');
    expect(anthropic('anthropic-429-spend-cap.json').errorClass).toBe('billing');
  });

  it('429 rate_limit_error is rate_limit with retry-after; 529 overloaded; 404 model_gone', () => {
    const rl = anthropic('anthropic-429-rate-limit.json');
    expect(rl.errorClass).toBe('rate_limit');
    expect(rl.retryAfterMs).toBe(7000);
    expect(anthropic('anthropic-529-overloaded.json').errorClass).toBe('overloaded');
    expect(anthropic('anthropic-404-model.json').errorClass).toBe('model_gone');
  });

  it('connection timeout and connection error', () => {
    expect(classifyAnthropic(new Anthropic.APIConnectionTimeoutError()).errorClass).toBe('timeout');
    expect(classifyAnthropic(new Anthropic.APIConnectionError({ message: 'ECONNRESET' })).errorClass).toBe('network');
  });
});

describe('head-of-data corrections (22 Nov evidence file)', () => {
  it('A1: Gemini no key (recorded 403 PERMISSION_DENIED) is auth; invalid key (400) is auth', () => {
    expect(gemini('gemini-403-no-key.json').errorClass).toBe('auth');
    expect(gemini('gemini-400-invalid-key.json').errorClass).toBe('auth');
    expect(classifyGemini(403, JSON.stringify({ error: { code: 403, message: 'Your account has an outstanding balance', status: 'PERMISSION_DENIED' } })).errorClass).toBe('billing');
  });

  it('A2: OpenAI billing on error.code OR error.type, every documented code', () => {
    for (const code of [
      'insufficient_quota',
      'credit_balance_exhausted',
      'organization_spend_limit_exceeded',
      'project_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
    ]) {
      expect(classifyOpenAi(429, JSON.stringify({ error: { message: 'x', type: 'requests', code } })).errorClass).toBe('billing');
    }
    expect(classifyOpenAi(429, JSON.stringify({ error: { message: 'x', type: 'insufficient_quota', code: 'something_new' } })).errorClass).toBe('billing');
    // message text alone never makes billing
    expect(classifyOpenAi(429, JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details', code: 'rate_limit_exceeded' } })).errorClass).toBe('rate_limit');
    expect(openAi('openai-401-no-key.json').errorClass).toBe('auth');
  });

  it('A3: Anthropic four billing shapes, spend cap is NOT rate_limit, 401 no key is auth', () => {
    expect(anthropic('anthropic-400-credit-balance.json').errorClass).toBe('billing');
    expect(anthropic('anthropic-400-usage-limit.json').errorClass).toBe('billing');
    const cap = anthropic('anthropic-429-spend-cap.json');
    expect(cap.errorClass).toBe('billing');
    expect(cap.retryAfterMs).toBeUndefined();
    expect(anthropic('anthropic-402-billing.json').errorClass).toBe('billing');
    expect(anthropic('anthropic-401-no-key.json').errorClass).toBe('auth');
    const ramp = classifyAnthropic(
      Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow', details: { error_code: 'ramp_limit_exceeded' } } }, undefined, new Headers({ 'retry-after': '2' })),
    );
    expect(ramp.errorClass).toBe('rate_limit');
    const timeout500 = classifyAnthropic(Anthropic.APIError.generate(500, { type: 'error', error: { type: 'timeout_error', message: 't' } }, undefined, new Headers()));
    expect(timeout500.errorClass).toBe('timeout');
  });

  it('A4: Gemini 429 by quotaId only (PerDay/FreeTier billing, PerMinute rate_limit, no details rate_limit)', () => {
    const msg = 'You exceeded your current quota, please check your plan and billing details.';
    const quota = (quotaId: string) =>
      JSON.stringify({ error: { code: 429, message: msg, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] }] } });
    expect(classifyGemini(429, quota('GenerateRequestsPerDayPerProjectPerModel')).errorClass).toBe('billing');
    expect(classifyGemini(429, quota('GenerateContentInputTokensPerModelPerMinute-FreeTier')).errorClass).toBe('billing');
    expect(classifyGemini(429, quota('GenerateRequestsPerMinutePerProjectPerModel')).errorClass).toBe('rate_limit');
    expect(classifyGemini(429, JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } })).errorClass).toBe('rate_limit');
    // the prepaid-credit text is not a rule any more: 402 is
    expect(gemini('gemini-402-payment-required.json').errorClass).toBe('billing');
  });

  it('Gemini newer string-code shape and FAILED_PRECONDITION', () => {
    expect(classifyGemini(429, JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'x' } })).errorClass).toBe('rate_limit');
    expect(classifyGemini(429, JSON.stringify({ error: { code: 'quota_exceeded', message: 'x' } })).errorClass).toBe('billing');
    expect(classifyGemini(404, JSON.stringify({ error: { code: 'model_not_found', message: 'x' } })).errorClass).toBe('model_gone');
    expect(classifyGemini(400, JSON.stringify({ error: { code: 400, message: 'billing disabled', status: 'FAILED_PRECONDITION' } })).errorClass).toBe('billing');
  });

  it('A6: recorded OpenAI 404 model_not_found (gpt-4.1-nano deprecated) is model_gone', () => {
    expect(openAi('openai-404-model.json').errorClass).toBe('model_gone');
  });
});

describe('classifyThrown', () => {
  it('AbortSignal timeout is timeout, anything else network', () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(classifyThrown('openai', timeout).errorClass).toBe('timeout');
    expect(classifyThrown('gemini', new TypeError('fetch failed')).errorClass).toBe('network');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, ms and HTTP dates', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '3' }))).toBe(3000);
    expect(parseRetryAfter(new Headers({ 'retry-after-ms': '250' }))).toBe(250);
    const now = Date.parse('2026-11-22T00:00:00Z');
    expect(parseRetryAfter(new Headers({ 'retry-after': 'Sun, 22 Nov 2026 00:00:10 GMT' }), now)).toBe(10_000);
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});

describe('sanitizeAiMessage', () => {
  it('strips OpenAI, Anthropic and Google keys, bearer tokens and key query params', () => {
    const dirty =
      'key sk-proj-abcdefghijklmnop and sk-ant-api03-ZZZZZZZZZZZZZZZZ, Bearer eyJhbGciOi.payload.sig, ' +
      'google AIzaSyA1234567890abcdefghijklmnop, url https://x.test/v1?key=AIzaSECRET&alt=json, x-api-key: sk-ant-xyz12345678';
    const clean = sanitizeAiMessage(dirty);
    expect(clean).not.toMatch(/sk-proj-abcdefghijklmnop|sk-ant-api03|eyJhbGciOi|AIzaSyA1234567890|AIzaSECRET|sk-ant-xyz/);
    expect(clean).toContain('[redacted]');
  });

  it('caps at 500 chars', () => {
    expect(sanitizeAiMessage('x'.repeat(2000)).length).toBeLessThanOrEqual(501);
  });

  it('error messages are sanitised at construction', () => {
    const e = classifyOpenAi(401, JSON.stringify({ error: { message: 'Incorrect API key provided: sk-live1234567890abcd' } }));
    expect(e.message).not.toContain('sk-live1234567890abcd');
  });
});
