import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAINS, resolveChain } from './chains';
import { forcedFailure, parseForceFail } from './force-fail';
import { createModelResolver, modelFor } from './models';
import { AI_TASKS } from './types';

describe('chains', () => {
  it('every task has a three-provider default chain', () => {
    for (const task of AI_TASKS) expect(DEFAULT_CHAINS[task]).toHaveLength(3);
  });

  it('OpenAI-first for discovery/judge/matrices, Gemini-first for content (Decision 2)', () => {
    expect(resolveChain('competitor_judge', {})).toEqual(['openai', 'anthropic', 'gemini']);
    expect(resolveChain('competitor_web_search', {})).toEqual(['openai', 'anthropic', 'gemini']);
    expect(resolveChain('matrix_score_chart', {})).toEqual(['openai', 'anthropic', 'gemini']);
    expect(resolveChain('content_draft', {})).toEqual(['gemini', 'openai', 'anthropic']);
    expect(resolveChain('quality_gate', {})).toEqual(['gemini', 'openai', 'anthropic']);
    expect(resolveChain('report_narrative', {})).toEqual(['gemini', 'openai', 'anthropic']);
  });

  it('AI_CHAIN_<TASK> overrides, AI_PROVIDER_DISABLED removes', () => {
    expect(resolveChain('competitor_judge', { AI_CHAIN_COMPETITOR_JUDGE: 'anthropic, openai' })).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(resolveChain('content_draft', { AI_PROVIDER_DISABLED: 'gemini' })).toEqual(['openai', 'anthropic']);
    expect(
      resolveChain('competitor_judge', { AI_CHAIN_COMPETITOR_JUDGE: 'anthropic,openai', AI_PROVIDER_DISABLED: 'anthropic' }),
    ).toEqual(['openai']);
  });

  it('unknown providers in an override are ignored loudly; an all-invalid override falls back to the default', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveChain('keywords', { AI_CHAIN_KEYWORDS: 'mistral' })).toEqual(DEFAULT_CHAINS.keywords);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown provider "mistral"'));
    spy.mockRestore();
  });
});

describe('AI_FORCE_FAIL', () => {
  it('parses provider:class pairs', () => {
    const parsed = parseForceFail('openai:billing, gemini:rate_limit');
    expect(parsed.get('openai')).toBe('billing');
    expect(parsed.get('gemini')).toBe('rate_limit');
    expect(parsed.has('anthropic')).toBe(false);
  });

  it('rejects malformed entries', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseForceFail('openai:nope,foo:billing,openai').size).toBe(0);
    spy.mockRestore();
  });

  it('applies outside production', () => {
    expect(forcedFailure('openai', { NODE_ENV: 'development', AI_FORCE_FAIL: 'openai:billing' })).toBe('billing');
    expect(forcedFailure('gemini', { NODE_ENV: 'test', AI_FORCE_FAIL: 'openai:billing' })).toBeNull();
  });

  it('is completely ignored when NODE_ENV=production', () => {
    expect(forcedFailure('openai', { NODE_ENV: 'production', AI_FORCE_FAIL: 'openai:billing' })).toBeNull();
  });
});

describe('models', () => {
  const settings = {
    getGeminiModel: async () => 'gemini-admin',
    getOpenAiFallbackModel: async () => 'gpt-admin',
  };

  it('Claude: Opus 5.5 for judges/matrices/gate, Sonnet 5.5 for the rest (Decision 1)', async () => {
    const resolve = createModelResolver({}, settings);
    expect(await resolve('anthropic', 'competitor_judge')).toBe('claude-opus-5-5');
    expect(await resolve('anthropic', 'matrix_summarise')).toBe('claude-opus-5-5');
    expect(await resolve('anthropic', 'quality_gate')).toBe('claude-opus-5-5');
    expect(await resolve('anthropic', 'content_draft')).toBe('claude-sonnet-5-5');
    expect(await resolve('anthropic', 'competitor_web_search')).toBe('claude-sonnet-5-5');
  });

  it('Claude env overrides', async () => {
    const resolve = createModelResolver({ ANTHROPIC_MODEL: 'm1', ANTHROPIC_MODEL_JUDGE: 'm2' }, settings);
    expect(await resolve('anthropic', 'keywords')).toBe('m1');
    expect(await resolve('anthropic', 'competitor_judge')).toBe('m2');
  });

  it('OpenAI keeps today’s sources: search model, admin model for lib/gemini.ts tasks, default model otherwise', async () => {
    const resolve = createModelResolver({ OPENAI_SEARCH_MODEL: 'gpt-search' }, settings);
    expect(await resolve('openai', 'competitor_web_search')).toBe('gpt-search');
    expect(await resolve('openai', 'content_draft')).toBe('gpt-admin');
    expect(await resolve('openai', 'competitor_judge')).toBe('gpt-4.1');
    expect(await createModelResolver({}, settings)('openai', 'competitor_web_search')).toBe('gpt-5-mini');
  });

  it('Gemini uses the admin setting; modelOverride wins', async () => {
    const resolve = createModelResolver({}, settings);
    expect(await resolve('gemini', 'competitor_judge')).toBe('gemini-admin');
    const request = { prompt: 'x', output: { kind: 'text' as const }, timeoutMs: 1, modelOverride: { gemini: 'g-x' } };
    expect(await modelFor(resolve, 'gemini', 'content_draft', request)).toBe('g-x');
    expect(await modelFor(resolve, 'openai', 'content_draft', request)).toBe('gpt-admin');
  });
});
