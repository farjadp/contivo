import { beforeEach, describe, expect, it, vi } from 'vitest';

// The judge goes through the failover layer (task `quality_gate`) and fails
// CLOSED: no judge answering means the draft waits, never publishes unjudged.
// The layer is mocked; no network.

const { runAiTaskMock } = vi.hoisted(() => ({ runAiTaskMock: vi.fn() }));

vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/app-settings', () => ({ getContentWordCountLimits: vi.fn() }));
vi.mock('@/lib/narrative/context', () => ({ storylinePromptBlock: () => '' }));

import { DEFAULT_CONTENT_WORD_COUNT_LIMITS } from '@/lib/content-word-count';

import * as gate from './quality-gate';
import { evaluateDraft, JUDGE_SYSTEM_PROMPT, JUDGE_TIMEOUT_MS } from './quality-gate';

const CONTENT = Array.from(
  { length: 160 },
  (_, i) => ['plan', 'your', 'content', 'calendar', 'around', 'customer', 'questions', 'weekly'][i % 8] + i,
).join(' ');

function input() {
  return {
    content: CONTENT,
    topic: 'Planning content',
    channel: 'linkedin',
    brandSummary: { name: 'Acme' },
    wordCountLimits: { ...DEFAULT_CONTENT_WORD_COUNT_LIMITS, linkedin: { min: 140, max: 200 } },
    aiContext: { workspaceId: 'ws-1', userId: 'user-1' },
  };
}

function judgeOk(json: unknown, provider = 'anthropic', model = 'claude-opus-5-5') {
  return {
    ok: true as const,
    provider,
    model,
    text: JSON.stringify(json),
    json,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    failedOver: [{ provider: 'gemini', errorClass: 'billing' }],
  };
}

const GOOD = { brand_fit: 9, factual_safety: 9, clarity: 9, verdict: 'approve', notes: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('quality gate exports for the calibration eval', () => {
  it('exports buildJudgePrompt and JUDGE_SYSTEM_PROMPT', () => {
    expect(typeof gate.buildJudgePrompt).toBe('function');
    expect(gate.buildJudgePrompt(input(), CONTENT, 'linkedin')).toContain('Return ONLY this JSON');
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/^You are a strict brand editor\./);
  });
});

describe('evaluateDraft on the failover layer', () => {
  it('calls runAiTask("quality_gate") with the exported system prompt, json_object and 90 s', async () => {
    runAiTaskMock.mockResolvedValue(judgeOk(GOOD));

    await evaluateDraft(input());

    expect(runAiTaskMock).toHaveBeenCalledTimes(1);
    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('quality_gate');
    expect(request).toMatchObject({
      system: JUDGE_SYSTEM_PROMPT,
      output: { kind: 'json_object' },
      timeoutMs: JUDGE_TIMEOUT_MS,
    });
    expect(JUDGE_TIMEOUT_MS).toBe(90_000);
    expect(ctx).toEqual({ workspaceId: 'ws-1', userId: 'user-1' });
  });

  it('records the provider and the model that actually answered', async () => {
    runAiTaskMock.mockResolvedValue(judgeOk(GOOD, 'anthropic', 'claude-opus-5-5'));

    const verdict = await evaluateDraft(input());

    expect(verdict.approved).toBe(true);
    expect(verdict.judge).toBe('anthropic');
    expect(verdict.judgeModel).toBe('claude-opus-5-5');
  });

  it('a rejection also carries provider and model', async () => {
    runAiTaskMock.mockResolvedValue(judgeOk({ ...GOOD, factual_safety: 2 }, 'gemini', 'gemini-2.5-flash'));

    const verdict = await evaluateDraft(input());

    expect(verdict.approved).toBe(false);
    expect(verdict.rejectedBy).toBe('low_score');
    expect(verdict).toMatchObject({ judge: 'gemini', judgeModel: 'gemini-2.5-flash' });
  });

  it.each(['all_unavailable', 'bad_request', 'refusal'] as const)(
    'fails CLOSED when the layer returns ok:false (%s): not approved, held as judge_unavailable',
    async (kind) => {
      runAiTaskMock.mockResolvedValue({
        ok: false,
        kind,
        attempts: [],
        firstErrorClass: 'billing',
        allRateLimited: false,
      });

      const verdict = await evaluateDraft(input());

      expect(verdict.approved).toBe(false);
      expect(verdict.rejectedBy).toBe('judge_unavailable');
      expect(verdict.judge).toBe('unavailable');
      expect(verdict.judgeModel).toBeNull();
    },
  );

  it('fails closed when the judge answered with something that is not an object', async () => {
    runAiTaskMock.mockResolvedValue(judgeOk(['approve']));

    const verdict = await evaluateDraft(input());

    expect(verdict.approved).toBe(false);
    expect(verdict.rejectedBy).toBe('judge_unavailable');
  });

  it('a deterministic reject never calls the judge', async () => {
    const verdict = await evaluateDraft({ ...input(), content: '' });

    expect(verdict).toMatchObject({ approved: false, rejectedBy: 'empty', judge: 'skipped', judgeModel: null });
    expect(runAiTaskMock).not.toHaveBeenCalled();
  });
});
