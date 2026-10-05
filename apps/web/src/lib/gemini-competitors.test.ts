import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app-settings', () => ({
  getGeminiCooldownSeconds: async () => 60,
  getGeminiModel: async () => 'gemini-test',
  getOpenAiFallbackModel: async () => 'gpt-test',
}));

import { discoverCompetitorsWithGemini } from './gemini';

const competitor = {
  name: 'Acme Dental',
  domain: 'acmedental.com',
  description: 'A family dental clinic.',
  category: 'Dental clinic',
  audienceGuess: 'Local families',
};

function respond(geminiStatus: number, openAiContent: string) {
  return vi.fn(async (url: string) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response('{"error":{"code":503}}', { status: geminiStatus });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: openAiContent } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('discoverCompetitorsWithGemini when Gemini is unavailable', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    vi.stubEnv('OPENAI_API_KEY', 'test');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unwraps the object OpenAI JSON mode returns', async () => {
    vi.stubGlobal('fetch', respond(503, JSON.stringify({ competitors: [competitor] })));
    await expect(discoverCompetitorsWithGemini({ name: 'Camgara' })).resolves.toEqual([competitor]);
  });

  it('still accepts a bare array', async () => {
    vi.stubGlobal('fetch', respond(503, JSON.stringify([competitor])));
    await expect(discoverCompetitorsWithGemini({ name: 'Camgara' })).resolves.toEqual([competitor]);
  });

  it('logs when OpenAI answered but the answer was unusable', async () => {
    vi.stubGlobal('fetch', respond(503, JSON.stringify({ competitors: [] })));
    await expect(discoverCompetitorsWithGemini({ name: 'Camgara' })).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/discoverCompetitorsWithGemini.*invalid/));
  });
});
