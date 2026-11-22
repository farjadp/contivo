/**
 * apps/web/src/app/actions/social-telegram.ts
 *
 * Server actions for the "Connect Telegram" panel. The browser never calls
 * the Nest API: each action mints the user's bearer (mintApiToken) and calls
 * /api/v1/social/telegram/connect-sessions/* from the server.
 *
 * Every failure comes back as a `code` the panel turns into a sentence
 * (lib/telegram-connect.ts TELEGRAM_ERROR_CODES); the API's English message is
 * logged, never shown.
 */

'use server';

import { revalidatePath } from 'next/cache';

import { mintApiToken } from '@/lib/auth';
import {
  isTelegramErrorCode,
  type TelegramErrorCode,
  type TelegramSessionStart,
  type TelegramSessionView,
} from '@/lib/telegram-connect';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type TelegramActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: TelegramErrorCode; attemptsLeft?: number };

/** Nest exception bodies: `{ statusCode, code, message, ...extra }`. */
function codeFor(status: number, body: unknown): TelegramErrorCode {
  const code = (body as { code?: unknown } | null)?.code;
  if (isTelegramErrorCode(code)) return code;
  if (status === 401) return 'session_expired';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'session_not_found';
  if (status === 429) return 'too_many_attempts';
  return 'api_error';
}

async function telegramFetch<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<TelegramActionResult<T>> {
  const token = await mintApiToken();
  if (!token) return { ok: false, code: 'session_expired' };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/social/telegram${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      cache: 'no-store',
    });
  } catch (err) {
    console.error(`Telegram connect API unreachable for ${path}:`, err);
    return { ok: false, code: 'unreachable' };
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = codeFor(res.status, body);
    if (res.status >= 500 || code === 'api_error') {
      console.error(`Telegram connect API ${res.status} for ${path}:`, (body as { message?: unknown } | null)?.message);
    }
    const attemptsLeft = (body as { attemptsLeft?: unknown } | null)?.attemptsLeft;
    return { ok: false, code, ...(typeof attemptsLeft === 'number' && { attemptsLeft }) };
  }
  if (!body || typeof body !== 'object') return { ok: false, code: 'api_error' };
  return { ok: true, data: body as T };
}

const sessionPath = (sessionId: string) => `/connect-sessions/${encodeURIComponent(sessionId)}`;

/** Starts a connect session for this workspace: the t.me deep link to open. */
export async function startTelegramConnect(workspaceId: string): Promise<TelegramActionResult<TelegramSessionStart>> {
  if (!workspaceId) return { ok: false, code: 'forbidden' };
  return telegramFetch<TelegramSessionStart>('/connect-sessions', { method: 'POST', body: { workspaceId } });
}

/** Where the session is now. The panel polls this while it is open. */
export async function getTelegramConnect(sessionId: string): Promise<TelegramActionResult<TelegramSessionView>> {
  return telegramFetch<TelegramSessionView>(sessionPath(sessionId), { method: 'GET' });
}

/** The six-digit code the bot sent. Persian digits are fine; the API normalises them too. */
export async function confirmTelegramConnect(sessionId: string, code: string): Promise<TelegramActionResult<TelegramSessionView>> {
  const result = await telegramFetch<TelegramSessionView>(`${sessionPath(sessionId)}/confirm`, {
    method: 'POST',
    body: { code },
  });
  if (result.ok) revalidatePath('/connections');
  return result;
}

/** A public channel where the bot is already admin: @name, name or t.me/name. */
export async function submitTelegramUsername(
  sessionId: string,
  username: string,
): Promise<TelegramActionResult<TelegramSessionView>> {
  return telegramFetch<TelegramSessionView>(`${sessionPath(sessionId)}/username`, {
    method: 'POST',
    body: { username },
  });
}
