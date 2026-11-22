/**
 * telegram-connect.ts
 *
 * The rules behind the "Connect Telegram" panel, kept pure so they are tested
 * without a browser: which step a connect session is on, which sentence an
 * error code gets, how a typed code is cleaned, and which parts of a
 * connection's metaJson the Connections page may show.
 *
 * The session itself lives in the API (apps/api/src/modules/social/telegram);
 * the web reads it through actions/social-telegram.ts.
 */

export type TelegramSessionStatus = 'waiting' | 'started' | 'pending_confirm' | 'connected' | 'failed';

export type TelegramChatType = 'channel' | 'group' | 'supergroup';

/** Problems the API records on the session itself (`view.error`). */
export type TelegramSessionProblem =
  | 'bot_not_admin'
  | 'user_not_admin'
  | 'chat_not_found'
  | 'not_a_channel_or_group'
  | 'telegram_unavailable'
  | 'too_many_attempts'
  /** The bot already sent its three codes for this session. */
  | 'too_many_codes'
  /** The Telegram user pressed "This wasn't me". */
  | 'denied';

export interface TelegramSessionView {
  sessionId: string;
  status: TelegramSessionStatus;
  expiresAt: string;
  telegramLinked: boolean;
  error?: TelegramSessionProblem;
  attemptsLeft?: number;
  connection?: { id: string; accountName: string; chatType: TelegramChatType; username?: string };
}

export interface TelegramSessionStart {
  sessionId: string;
  deepLink: string;
  expiresAt: string;
}

/**
 * Every reason a Telegram action can fail, as the panel branches on it: the
 * API's own `code`s plus the transport failures the server action adds.
 * Each one has a sentence under `connections.telegram.errors`.
 */
export const TELEGRAM_ERROR_CODES = [
  'bot_not_admin',
  'user_not_admin',
  'chat_not_found',
  'not_a_channel_or_group',
  'telegram_unavailable',
  'too_many_attempts',
  'too_many_codes',
  'denied',
  'already_pending',
  'session_finished',
  'too_many_lookups',
  'wrong_code',
  'not_pending',
  'start_bot_first',
  'invalid_username',
  'session_not_found',
  'telegram_not_configured',
  'store_unavailable',
  'session_expired',
  'forbidden',
  'unreachable',
  'api_error',
] as const;

export type TelegramErrorCode = (typeof TELEGRAM_ERROR_CODES)[number];

export function isTelegramErrorCode(value: unknown): value is TelegramErrorCode {
  return typeof value === 'string' && (TELEGRAM_ERROR_CODES as readonly string[]).includes(value);
}

/** Poll interval while the panel is open and the session is still moving. */
export const TELEGRAM_POLL_MS = 2500;

/** The code the bot sends is six digits. */
export const TELEGRAM_CODE_LENGTH = 6;

/**
 * Action failures that end the session: the panel shows the "Start again"
 * screen with this sentence instead of an inline error.
 */
export function endsSession(
  code: TelegramErrorCode,
): code is 'too_many_attempts' | 'too_many_codes' | 'denied' | 'session_finished' {
  return code === 'too_many_attempts' || code === 'too_many_codes' || code === 'denied' || code === 'session_finished';
}

/** The sentence key for the "stopped" screen. A failed session without a reason is simply over. */
export function failedReason(view: TelegramSessionView | null, actionError: TelegramErrorCode | null): TelegramErrorCode {
  return view?.error ?? actionError ?? 'session_finished';
}

export function isTerminalStatus(status: TelegramSessionStatus): boolean {
  return status === 'connected' || status === 'failed';
}

export function isExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && now >= at;
}

/**
 * Which screen the panel shows.
 * - open: the deep link, waiting for Start in Telegram;
 * - choose: Start was tapped, pick the channel inside Telegram;
 * - username: the "my channel is public and the bot is already admin" path;
 * - code: the bot sent a code;
 * - connected / failed / expired: the session is over.
 */
export type TelegramPanelStep = 'open' | 'choose' | 'username' | 'code' | 'connected' | 'failed' | 'expired';

export function panelStep(
  view: TelegramSessionView | null,
  opts: { expired: boolean; usernameMode: boolean },
): TelegramPanelStep {
  if (view?.status === 'connected') return 'connected';
  if (view?.status === 'failed') return 'failed';
  if (opts.expired) return 'expired';
  if (view?.status === 'pending_confirm') return 'code';
  if (opts.usernameMode) return 'username';
  if (view?.status === 'started' || view?.telegramLinked) return 'choose';
  return 'open';
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** What the user typed into the code box → at most six Latin digits. Persian and Arabic digits count. */
export function normalizeCodeInput(input: string): string {
  return String(input ?? '')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/\D/g, '')
    .slice(0, TELEGRAM_CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${TELEGRAM_CODE_LENGTH}}$`).test(code);
}

/** Same rule as the API's parseTelegramUsername; used only to build a link, never to decide access. */
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function telegramChatUrl(username: string | null | undefined): string | null {
  const name = String(username ?? '').trim().replace(/^@/, '');
  return TELEGRAM_USERNAME.test(name) ? `https://t.me/${name}` : null;
}

export type TelegramRevokedReason = 'BOT_REMOVED' | 'BOT_RIGHTS_LOST';

/** The parts of SocialConnection.metaJson the Connections page shows. Nothing else leaves the server. */
export interface ConnectionMeta {
  chatType: TelegramChatType | null;
  username: string | null;
  revokedReason: TelegramRevokedReason | null;
}

export function pickConnectionMeta(metaJson: unknown): ConnectionMeta {
  const meta = metaJson && typeof metaJson === 'object' && !Array.isArray(metaJson) ? (metaJson as Record<string, unknown>) : {};
  const chatType =
    meta.chatType === 'channel' || meta.chatType === 'group' || meta.chatType === 'supergroup' ? meta.chatType : null;
  const username = typeof meta.username === 'string' && TELEGRAM_USERNAME.test(meta.username) ? meta.username : null;
  const revokedReason =
    meta.revokedReason === 'BOT_REMOVED' || meta.revokedReason === 'BOT_RIGHTS_LOST' ? meta.revokedReason : null;
  return { chatType, username, revokedReason };
}
