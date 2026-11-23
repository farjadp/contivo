import { describe, expect, it } from 'vitest';

import { AiProviderError, classifyAnthropic, classifyGemini, classifyOpenAi } from '@/lib/ai/errors';
import { InsufficientCreditsError } from '@/lib/credits';

import { classifyCause, classifyCauseFromStored } from './cause';
import { CAUSE_CODES } from './types';

// Recorded 22 Nov against api.openai.com (lib/ai/__fixtures__/openai-429-insufficient-quota.json).
const OPENAI_OUT_OF_CREDIT_BODY = {
  error: {
    message:
      'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
    type: 'insufficient_quota',
    param: null,
    code: 'credit_balance_exhausted',
  },
};

describe('classifyCause: providers', () => {
  it('real OpenAI out-of-credit body (429) is OUT_OF_CREDIT, not RATE_LIMITED', () => {
    expect(classifyCause(classifyOpenAi(429, OPENAI_OUT_OF_CREDIT_BODY))).toBe('PROVIDER_OUT_OF_CREDIT');
  });
  it('raw error object carrying the same body', () => {
    expect(classifyCause({ status: 429, error: OPENAI_OUT_OF_CREDIT_BODY.error })).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(classifyCause(new Error(`OpenAI 429: ${JSON.stringify(OPENAI_OUT_OF_CREDIT_BODY)}`))).toBe(
      'PROVIDER_OUT_OF_CREDIT',
    );
  });
  it('429 with quota text and billing_hard_limit', () => {
    expect(classifyCause({ status: 429, message: 'You exceeded your current quota, please check your plan' })).toBe(
      'PROVIDER_OUT_OF_CREDIT',
    );
    expect(classifyCause({ error: { code: 'billing_hard_limit_reached' } })).toBe('PROVIDER_OUT_OF_CREDIT');
  });
  it('plain 429 is RATE_LIMITED', () => {
    expect(classifyCause(classifyOpenAi(429, { error: { type: 'requests', code: 'rate_limit_exceeded', message: 'Slow down' } }))).toBe(
      'PROVIDER_RATE_LIMITED',
    );
    expect(classifyCause({ status: 429, message: 'Too many requests' })).toBe('PROVIDER_RATE_LIMITED');
  });
  it('Anthropic credit balance too low', () => {
    const e = new AiProviderError({ provider: 'anthropic', errorClass: 'billing', message: 'Your credit balance is too low' });
    expect(classifyCause(e)).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(classifyCause(new Error('400 invalid_request_error: Your credit balance is too low to access the Anthropic API'))).toBe(
      'PROVIDER_OUT_OF_CREDIT',
    );
    expect(classifyAnthropic(new Error('x'))).toBeInstanceOf(AiProviderError);
  });
  it('Gemini RESOURCE_EXHAUSTED quota', () => {
    const body = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } };
    expect(classifyCause(new Error(JSON.stringify(body)))).toBe('PROVIDER_OUT_OF_CREDIT');
    const perDay = {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'quota',
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }],
      },
    };
    expect(classifyCause(classifyGemini(429, perDay))).toBe('PROVIDER_OUT_OF_CREDIT');
  });
  it('AiProviderError classes', () => {
    const mk = (errorClass: ConstructorParameters<typeof AiProviderError>[0]['errorClass']) =>
      classifyCause(new AiProviderError({ provider: 'openai', errorClass, message: 'x' }));
    expect(mk('rate_limit')).toBe('PROVIDER_RATE_LIMITED');
    expect(mk('auth')).toBe('PROVIDER_AUTH');
    expect(mk('model_gone')).toBe('PROVIDER_AUTH');
    expect(mk('timeout')).toBe('PROVIDER_TIMEOUT');
    expect(mk('overloaded')).toBe('PROVIDER_UNAVAILABLE');
    expect(mk('server')).toBe('PROVIDER_UNAVAILABLE');
    expect(mk('bad_request')).toBe('UNKNOWN');
  });
  it('bad key text', () => {
    expect(classifyCause(new Error('401 Incorrect API key provided'))).toBe('PROVIDER_AUTH');
  });
});

describe('classifyCause: other', () => {
  it('Contivo credits', () => {
    expect(classifyCause(new InsufficientCreditsError(1, 5))).toBe('CREDITS_EXHAUSTED');
  });
  it('database', () => {
    const e = Object.assign(new Error('boom'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    expect(classifyCause(e)).toBe('DATABASE');
    expect(classifyCause(Object.assign(new Error('x'), { name: 'PrismaClientInitializationError' }))).toBe('DATABASE');
  });
  it('validation, timeouts, connection', () => {
    expect(classifyCause(Object.assign(new Error('x'), { name: 'ZodError' }))).toBe('VALIDATION');
    expect(classifyCause(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('TIMED_OUT');
    expect(classifyCause({ code: 'session_expired' })).toBe('CONNECTION_EXPIRED');
  });
  it('unknowns never throw and always return a listed code', () => {
    for (const v of [null, undefined, 0, {}, [], new Error('plain'), 'whatever', Symbol('x')]) {
      expect(CAUSE_CODES).toContain(classifyCause(v));
    }
    expect(classifyCause(new Error('plain'))).toBe('UNKNOWN');
  });
});

describe('classifyCauseFromStored', () => {
  it('reads the cooldown reason; ignores not_configured next to a real cause', () => {
    const wrap = (a: string) => `AI_UNAVAILABLE: Matrix AI call x failed: all_unavailable (${a})`;
    expect(classifyCauseFromStored(wrap('openai:cooling_down:billing, anthropic:not_configured'))).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(classifyCauseFromStored(wrap('anthropic:not_configured, openai:billing:429'))).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(classifyCauseFromStored(wrap('openai:timeout, gemini:auth:401'))).toBe('PROVIDER_AUTH');
    expect(classifyCauseFromStored(wrap('openai:timeout, anthropic:not_configured'))).toBe('PROVIDER_TIMEOUT');
    expect(classifyCauseFromStored(wrap('openai:rate_limit:429, anthropic:not_configured'))).toBe('PROVIDER_RATE_LIMITED');
  });
  it('old rows without a reason still parse', () => {
    expect(classifyCauseFromStored('AI_UNAVAILABLE: x: all_unavailable (anthropic:not_configured)')).toBe('PROVIDER_AUTH');
    expect(classifyCauseFromStored('AI_UNAVAILABLE: x: all_unavailable (openai:billing:429, anthropic:not_configured)')).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(classifyCauseFromStored('AI_UNAVAILABLE: x: all_unavailable (openai:cooling_down, anthropic:not_configured)')).toBe('PROVIDER_AUTH');
  });
  it('null for empty and unrecognised', () => {
    expect(classifyCauseFromStored(null)).toBeNull();
    expect(classifyCauseFromStored(undefined)).toBeNull();
    expect(classifyCauseFromStored('')).toBeNull();
    expect(classifyCauseFromStored('OPENAI_API_KEY is not set')).toBeNull();
    expect(classifyCauseFromStored('cooling_down')).toBeNull();
  });
  it('ai_provider_events.errorClass values', () => {
    expect(classifyCauseFromStored('billing')).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(classifyCauseFromStored('rate_limit')).toBe('PROVIDER_RATE_LIMITED');
    expect(classifyCauseFromStored('timeout')).toBe('PROVIDER_TIMEOUT');
    expect(classifyCauseFromStored('auth')).toBe('PROVIDER_AUTH');
    expect(classifyCauseFromStored('overloaded')).toBe('PROVIDER_UNAVAILABLE');
  });
  it('run errors', () => {
    expect(classifyCauseFromStored('TIMED_OUT')).toBe('TIMED_OUT');
    expect(classifyCauseFromStored('DISPATCH_FAILED: x')).toBe('DISPATCH_FAILED');
    expect(classifyCauseFromStored('NOT_ENOUGH_EVIDENCE')).toBe('NOT_ENOUGH_EVIDENCE');
    expect(classifyCauseFromStored('OUT_OF_CREDITS')).toBe('CREDITS_EXHAUSTED');
  });
  it('the 22 Nov matrices failure row', () => {
    expect(
      classifyCauseFromStored('JUDGE_UNAVAILABLE: Judge batch failed: 429 {"error":{"type":"insufficient_quota"}}'),
    ).toBe('PROVIDER_OUT_OF_CREDIT');
  });
  it('AI_UNAVAILABLE rows from describeAiFailure', () => {
    expect(classifyCauseFromStored('AI_UNAVAILABLE: judge: all_unavailable (openai:billing:429, gemini:rate_limit:429)')).toBe(
      'PROVIDER_OUT_OF_CREDIT',
    );
    expect(classifyCauseFromStored('AI_UNAVAILABLE: judge: all_unavailable (openai:server:500)')).toBe('PROVIDER_UNAVAILABLE');
    expect(classifyCauseFromStored('JUDGE_UNAVAILABLE: Judge batch failed: 429 Rate limit')).toBe('PROVIDER_RATE_LIMITED');
    expect(classifyCauseFromStored('SEARCH_UNAVAILABLE')).toBe('PROVIDER_UNAVAILABLE');
  });
});
