import { beforeEach, describe, expect, it, vi } from 'vitest';

// The provider chain itself is tested in lib/ai; here only what this module
// asks for and what it does with the answer.
const { runAiTaskMock } = vi.hoisted(() => ({ runAiTaskMock: vi.fn() }));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));

import { discoverCompetitorsWithGemini } from './gemini';

const competitor = {
  name: 'Acme Dental',
  domain: 'acmedental.com',
  description: 'A family dental clinic.',
  category: 'Dental clinic',
  audienceGuess: 'Local families',
};

const failure = {
  ok: false,
  kind: 'all_unavailable',
  attempts: [],
  firstErrorClass: 'billing',
  allRateLimited: false,
};

describe('discoverCompetitorsWithGemini on the failover layer', () => {
  beforeEach(() => {
    runAiTaskMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('asks for a {competitors: [...]} object under the legacy_competitors task and unwraps it', async () => {
    runAiTaskMock.mockResolvedValue({ ok: true, provider: 'openai', model: 'gpt-test', text: '', json: { competitors: [competitor] } });

    await expect(discoverCompetitorsWithGemini({ name: 'Camgara' }, 'EN', { workspaceId: 'ws-1' })).resolves.toEqual([
      competitor,
    ]);

    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('legacy_competitors');
    expect(request.output.kind).toBe('json_schema');
    expect(request.output.schema.required).toEqual(['competitors']);
    expect(request.prompt).toContain('{"competitors": [...]}');
    expect(ctx).toEqual({ workspaceId: 'ws-1' });
  });

  it('returns null, not an empty list, when the chain fails, so the caller can tell failure from "none"', async () => {
    runAiTaskMock.mockResolvedValue(failure);
    await expect(discoverCompetitorsWithGemini({ name: 'Camgara' })).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/discoverCompetitorsWithGemini.*legacy_competitors.*billing/));
  });

  it('returns null when the answer holds no competitors', async () => {
    runAiTaskMock.mockResolvedValue({ ok: true, provider: 'gemini', model: 'g', text: '', json: { competitors: [] } });
    await expect(discoverCompetitorsWithGemini({ name: 'Camgara' })).resolves.toBeNull();
  });
});
