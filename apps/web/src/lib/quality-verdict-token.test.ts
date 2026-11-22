import { beforeEach, describe, expect, it } from 'vitest';

import { signVerdictToken, verifyVerdictToken, VERDICT_TOKEN_TTL_MS } from './quality-verdict-token';
import type { StoredVerdict } from './quality-verdict';

const verdict: StoredVerdict = {
  approved: true,
  rejectedBy: null,
  reasons: [],
  scores: { brandFit: 8, factualSafety: 9, clarity: 8, storylineFit: null, evidenceDiscipline: null },
  judge: 'openai',
  judgeModel: 'gpt-x',
  checkedAt: '2026-11-22T10:00:00.000Z',
  source: 'preview',
};

const base = { text: 'A finished post.', workspaceId: 'ws-a', channel: 'linkedin' };

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-for-verdict-tokens';
});

describe('verdict token', () => {
  it('round-trips the verdict for the same text, workspace and channel', () => {
    const token = signVerdictToken({ ...base, verdict });
    expect(verifyVerdictToken(token, base)).toEqual(verdict);
  });

  it('ignores surrounding whitespace in the text', () => {
    const token = signVerdictToken({ ...base, verdict });
    expect(verifyVerdictToken(token, { ...base, text: `  ${base.text}\n` })).toEqual(verdict);
  });

  it('rejects changed text', () => {
    const token = signVerdictToken({ ...base, verdict });
    expect(verifyVerdictToken(token, { ...base, text: 'A finished post!' })).toBeNull();
  });

  it('rejects another workspace or channel', () => {
    const token = signVerdictToken({ ...base, verdict });
    expect(verifyVerdictToken(token, { ...base, workspaceId: 'ws-b' })).toBeNull();
    expect(verifyVerdictToken(token, { ...base, channel: 'twitter' })).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const token = signVerdictToken({ ...base, verdict, now });
    expect(verifyVerdictToken(token, { ...base, now: now + VERDICT_TOKEN_TTL_MS + 1 })).toBeNull();
  });

  it('rejects a token whose verdict was edited by the client', () => {
    const token = signVerdictToken({ ...base, verdict: { ...verdict, approved: false, rejectedBy: 'low_score' } })!;
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.v.approved = true;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect(verifyVerdictToken(forged, base)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyVerdictToken(undefined, base)).toBeNull();
    expect(verifyVerdictToken('nope', base)).toBeNull();
    expect(verifyVerdictToken('a.b', base)).toBeNull();
  });

  it('issues nothing and accepts nothing without a secret', () => {
    const token = signVerdictToken({ ...base, verdict });
    delete process.env.JWT_SECRET;
    expect(signVerdictToken({ ...base, verdict })).toBeNull();
    expect(verifyVerdictToken(token, base)).toBeNull();
  });
});
