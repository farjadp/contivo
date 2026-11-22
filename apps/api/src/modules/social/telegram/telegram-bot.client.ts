/**
 * telegram-bot.client.ts
 *
 * Minimal typed client for the Telegram Bot API (https://core.telegram.org/bots/api).
 * One Contivo bot; the token comes from TELEGRAM_BOT_TOKEN only.
 *
 * The token is part of the URL path (`/bot<token>/<method>`), so:
 *   - no URL is ever put in an error, log line or result;
 *   - every description that leaves this file is scrubbed of the token.
 *
 * Never throws. Every call returns `{ ok: true, result }` or a classified
 * failure the adapter maps to ConnectionHealth / PublishResult:
 *   revoked       403, or 400 "chat not found" / "not enough rights" / … → REVOKED
 *   rate_limited  429 (or error_code 429) → retry after parameters.retry_after
 *   migrated      parameters.migrate_to_chat_id (group → supergroup) → new id
 *   unauthorized  401: OUR bot token is wrong. Not the customer's problem.
 *   bad_request   any other 4xx (e.g. "can't parse entities")
 *   server        5xx: the request arrived; a send may have happened
 *   unreachable   network failure before the request left → safe to retry
 *   ambiguous     timeout / reset after sending → a send may have happened
 *   not_configured  TELEGRAM_BOT_TOKEN unset; no request made
 *
 * TELEGRAM_API_BASE overrides https://api.telegram.org for tests (a local fake
 * server). It is not a production setting: with NODE_ENV=production it is
 * ignored and logged as an error (a wrong base would send the bot token to
 * whatever host it names).
 */

import { Injectable, Logger } from '@nestjs/common';

import { describeFetchError, isPreSendNetworkError } from '../adapters/http-health';

export const TELEGRAM_TIMEOUT_MS = 10_000;

/**
 * What the bot subscribes to. Never channel_post: we do not read customers' channels.
 * callback_query: only presses of the bot's own inline buttons ("This wasn't me").
 */
export const TELEGRAM_ALLOWED_UPDATES = ['message', 'my_chat_member', 'callback_query'] as const;

/** Dev-only overrides (polling mode, TELEGRAM_API_BASE) are refused when NODE_ENV=production. */
export function telegramDevSettingsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV?.trim() !== 'production';
}

const DEFAULT_API_BASE = 'https://api.telegram.org';

export type TelegramFailureKind =
  | 'revoked'
  | 'rate_limited'
  | 'migrated'
  | 'unauthorized'
  | 'bad_request'
  | 'server'
  | 'unreachable'
  | 'ambiguous'
  | 'not_configured';

export type TelegramFailure = {
  ok: false;
  kind: TelegramFailureKind;
  /** Token-free, capped. Safe for logs and the DB. */
  description: string;
  status?: number;
  errorCode?: number;
  retryAfterSec?: number;
  migrateToChatId?: number;
};

export type TelegramResult<T> = { ok: true; result: T } | TelegramFailure;

// ─── Bot API types (only the fields we read) ──────────────────────────────────

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TgChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: TgUser;
  can_post_messages?: boolean;
  can_send_messages?: boolean;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  date?: number;
  text?: string;
  chat_shared?: { request_id: number; chat_id: number; title?: string; username?: string };
  migrate_to_chat_id?: number;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
  callback_query?: TgCallbackQuery;
}

/** The 11 required booleans of ChatAdministratorRights, plus channel-only can_post_messages. */
export interface TgAdministratorRights {
  is_anonymous: boolean;
  can_manage_chat: boolean;
  can_delete_messages: boolean;
  can_manage_video_chats: boolean;
  can_restrict_members: boolean;
  can_promote_members: boolean;
  can_change_info: boolean;
  can_invite_users: boolean;
  can_post_stories: boolean;
  can_edit_stories: boolean;
  can_delete_stories: boolean;
  can_post_messages?: boolean;
}

export type TgReplyMarkup =
  | {
      keyboard: Array<Array<{
        text: string;
        request_chat?: {
          request_id: number;
          chat_is_channel: boolean;
          user_administrator_rights?: TgAdministratorRights;
          bot_administrator_rights?: TgAdministratorRights;
          request_title?: boolean;
          request_username?: boolean;
        };
      }>>;
      one_time_keyboard?: boolean;
      resize_keyboard?: boolean;
    }
  | { remove_keyboard: true }
  | { inline_keyboard: Array<Array<{ text: string; url: string } | { text: string; callback_data: string }>> };

export interface SendMessageParams {
  chat_id: string | number;
  text: string;
  parse_mode?: 'HTML';
  link_preview_options?: { is_disabled?: boolean };
  reply_markup?: TgReplyMarkup;
}

export interface SendPhotoParams {
  chat_id: string | number;
  photo: { data: Buffer; mimeType: string; filename?: string };
  caption?: string;
  parse_mode?: 'HTML';
}

export interface SetWebhookParams {
  url: string;
  secret_token: string;
  allowed_updates: string[];
  drop_pending_updates?: boolean;
}

// ─── Classification ───────────────────────────────────────────────────────────

/** 400 descriptions that mean the bot lost the chat or its rights. Not documented; matched loosely. */
const REVOKED_400 =
  /chat not found|not enough rights|need administrator rights|have no rights|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|bot is not a member|bot was kicked|bot was blocked|group chat was deactivated|PEER_ID_INVALID|CHANNEL_PRIVATE|member list is inaccessible/i;

interface ApiErrorBody {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

const MAX_DESC = 300;

export function classifyTelegramError(status: number, body: ApiErrorBody | null): Omit<TelegramFailure, 'description'> & { description: string } {
  const code = typeof body?.error_code === 'number' ? body.error_code : status;
  const description = String(body?.description ?? `HTTP ${status}`);
  const params = body?.parameters ?? {};
  const base = { ok: false as const, status, errorCode: code, description };

  if (typeof params.migrate_to_chat_id === 'number') {
    return { ...base, kind: 'migrated', migrateToChatId: params.migrate_to_chat_id };
  }
  if (code === 429) {
    return { ...base, kind: 'rate_limited', retryAfterSec: typeof params.retry_after === 'number' ? params.retry_after : undefined };
  }
  if (code === 401) return { ...base, kind: 'unauthorized' };
  if (code === 403) return { ...base, kind: 'revoked' };
  if (code === 400 && REVOKED_400.test(description)) return { ...base, kind: 'revoked' };
  if (code >= 500) return { ...base, kind: 'server' };
  return { ...base, kind: 'bad_request' };
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface TelegramClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Where TELEGRAM_BOT_TOKEN / TELEGRAM_API_BASE are read; default process.env (read per call). */
  env?: NodeJS.ProcessEnv;
}

@Injectable()
export class TelegramBotClient {
  private static readonly logger = new Logger(TelegramBotClient.name);
  private static warnedApiBase = false;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly env?: NodeJS.ProcessEnv;
  private identity: { token: string; bot: TgUser } | null = null;

  constructor(opts: TelegramClientOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.env = opts.env;
  }

  /** Read at call time so a deploy that sets the env later needs no rebuild of this object. */
  private token(): string | undefined {
    return (this.env ?? process.env).TELEGRAM_BOT_TOKEN?.trim() || undefined;
  }

  private base(): string {
    const env = this.env ?? process.env;
    const override = env.TELEGRAM_API_BASE?.trim();
    if (!override) return DEFAULT_API_BASE;
    if (!telegramDevSettingsAllowed(env)) {
      if (!TelegramBotClient.warnedApiBase) {
        TelegramBotClient.warnedApiBase = true;
        TelegramBotClient.logger.error('TELEGRAM_API_BASE is set with NODE_ENV=production; ignored, using api.telegram.org. Remove it from the deployment.');
      }
      return DEFAULT_API_BASE;
    }
    return override.replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return !!this.token();
  }

  /** Removes the token from any text before it leaves this file. */
  private scrub(text: string): string {
    const token = this.token();
    let out = token ? text.split(token).join('<bot-token>') : text;
    out = out.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<bot-token>');
    return out.length > MAX_DESC ? `${out.slice(0, MAX_DESC)}…` : out;
  }

  private async call<T>(method: string, body: Record<string, unknown> | FormData, timeoutMs = this.timeoutMs): Promise<TelegramResult<T>> {
    const token = this.token();
    if (!token) {
      return { ok: false, kind: 'not_configured', description: 'TELEGRAM_BOT_TOKEN is not set on the API.' };
    }
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base()}/bot${token}/${method}`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        ...(isForm
          ? { body: body as FormData }
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      });
    } catch (err) {
      return {
        ok: false,
        kind: isPreSendNetworkError(err) ? 'unreachable' : 'ambiguous',
        description: this.scrub(`Telegram ${method} failed: ${describeFetchError(err)}`),
      };
    }

    let parsed: (ApiErrorBody & { result?: T }) | null = null;
    try {
      parsed = (await res.json()) as ApiErrorBody & { result?: T };
    } catch {
      parsed = null;
    }
    if (res.ok && parsed?.ok === true) return { ok: true, result: parsed.result as T };

    const failure = classifyTelegramError(res.status, parsed);
    return { ...failure, description: this.scrub(`Telegram ${method}: ${failure.description}`) };
  }

  getMe() {
    return this.call<TgUser>('getMe', {});
  }

  /** getMe, cached per token: the bot's own id for getChatMember. */
  async getBotIdentity(): Promise<TelegramResult<TgUser>> {
    const token = this.token();
    if (this.identity && this.identity.token === token) return { ok: true, result: this.identity.bot };
    const res = await this.getMe();
    if (res.ok && token) this.identity = { token, bot: res.result };
    return res;
  }

  getChat(chatId: string | number) {
    return this.call<TgChat>('getChat', { chat_id: chatId });
  }

  getChatMember(chatId: string | number, userId: number) {
    return this.call<TgChatMember>('getChatMember', { chat_id: chatId, user_id: userId });
  }

  sendMessage(params: SendMessageParams) {
    return this.call<TgMessage>('sendMessage', { ...params });
  }

  sendPhoto(params: SendPhotoParams) {
    const form = new FormData();
    form.append('chat_id', String(params.chat_id));
    if (params.caption !== undefined) form.append('caption', params.caption);
    if (params.parse_mode) form.append('parse_mode', params.parse_mode);
    const bytes = new Uint8Array(params.photo.data);
    form.append('photo', new Blob([bytes], { type: params.photo.mimeType }), params.photo.filename ?? 'image');
    return this.call<TgMessage>('sendPhoto', form);
  }

  /** Stops the spinner on an inline button press. */
  answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.call<boolean>('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text && { text }) });
  }

  setWebhook(params: SetWebhookParams) {
    return this.call<boolean>('setWebhook', { ...params });
  }

  getWebhookInfo() {
    return this.call<{
      url: string;
      pending_update_count: number;
      last_error_date?: number;
      last_error_message?: string;
      allowed_updates?: string[];
    }>('getWebhookInfo', {});
  }

  deleteWebhook(dropPendingUpdates = false) {
    return this.call<boolean>('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
  }

  /** Long poll (dev only). The HTTP timeout is the poll timeout plus 10 s. */
  getUpdates(params: { offset?: number; timeout?: number; allowed_updates?: string[] }) {
    const pollSec = params.timeout ?? 0;
    return this.call<TgUpdate[]>('getUpdates', { ...params }, pollSec * 1000 + this.timeoutMs);
  }
}
