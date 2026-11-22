/**
 * quality-verdict-token.ts
 *
 * Ideation → Generate Preview runs the quality gate once and shows the
 * verdict. Add to Pipeline then saves that same text, and must not pay for a
 * second judge call. But the server cannot trust a verdict the browser sends
 * back, so the preview action also returns this token: an HMAC over the text's
 * hash, the verdict, the workspace, the channel and an expiry. On save, a valid
 * token whose hash matches the text being saved is stored as the verdict;
 * anything else is stored as "not checked".
 *
 * Keyed with JWT_SECRET, which every environment already has. Without it no
 * token is issued and every preview save is "not checked" — never a pass.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { StoredVerdict } from '@/lib/quality-verdict';

export const VERDICT_TOKEN_TTL_MS = 30 * 60 * 1000;

type TokenPayload = {
  /** sha256 of the trimmed text that was judged. */
  h: string;
  w: string;
  c: string;
  exp: number;
  v: StoredVerdict;
};

function secret(): string | null {
  const s = process.env.JWT_SECRET?.trim();
  return s ? s : null;
}

export function hashText(text: string): string {
  return createHash('sha256').update(String(text ?? '').trim(), 'utf8').digest('hex');
}

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

export function signVerdictToken(input: {
  text: string;
  workspaceId: string;
  channel: string;
  verdict: StoredVerdict;
  now?: number;
}): string | null {
  const key = secret();
  if (!key) return null;
  const payload: TokenPayload = {
    h: hashText(input.text),
    w: input.workspaceId,
    c: String(input.channel),
    exp: (input.now ?? Date.now()) + VERDICT_TOKEN_TTL_MS,
    v: input.verdict,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, key)}`;
}

/**
 * The verdict the token carries, or null when it is missing, forged, expired,
 * for another workspace or channel, or for different text.
 */
export function verifyVerdictToken(
  token: unknown,
  expected: { text: string; workspaceId: string; channel: string; now?: number },
): StoredVerdict | null {
  const key = secret();
  if (!key || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'utf8');
  const wanted = Buffer.from(sign(body, key), 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || !payload.v) return null;
  if (typeof payload.exp !== 'number' || payload.exp < (expected.now ?? Date.now())) return null;
  if (payload.w !== expected.workspaceId) return null;
  if (payload.c !== String(expected.channel)) return null;
  if (payload.h !== hashText(expected.text)) return null;
  return payload.v;
}
