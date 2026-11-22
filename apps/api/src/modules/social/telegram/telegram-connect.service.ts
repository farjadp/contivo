/**
 * telegram-connect.service.ts
 *
 * Connects a Telegram channel or group to a workspace through the one Contivo
 * bot (spec 2026-11-21-publishing-channels-design.md §3, option d), and
 * handles the bot's updates (webhook or dev polling).
 *
 * Flow:
 *   1. Web (signed in) → POST /social/telegram/connect-sessions { workspaceId }
 *      → session in Redis (10 min) bound to { userId, workspaceId }, and a deep
 *      link https://t.me/<bot>?start=<nonce> (16 random bytes, base64url).
 *   2. User taps Start → update `/start <nonce>` in the private chat → the
 *      session is bound to that Telegram user (first one wins) and the bot
 *      replies with request_chat buttons (channel: bot + user must be admins
 *      who can post; Telegram grants the bot the rights itself; group button).
 *   3. `chat_shared` → getChatMember for the bot AND the sharing user must
 *      show they can post → the chat is PARKED in the session (nothing saved)
 *      and the bot sends a 6-digit code to that Telegram user.
 *   4. Web → POST …/:id/confirm { code } → only the web user who created the
 *      session, and only with the code → rights re-checked → saved through
 *      SocialConnectionsService.create() (upsert).
 *
 * Why the code (connection CSRF, the lesson from PR #20): anyone signed in can
 * create a session for their own workspace and send the deep link to a
 * victim. Saving on chat_shared — or on a confirm that only checks "is this
 * the session creator" — puts the victim's channel into the attacker's
 * workspace, because the attacker IS the creator. The code goes only to the
 * Telegram user who shared the chat, so saving needs both halves: the web
 * account that started the session and the Telegram account that owns the
 * chat. The bot also names the workspace in its first message, so a tricked
 * victim sees whose workspace it is, and offers a "This wasn't me" button that
 * kills the session.
 *
 * Limits (security review 2026-11-22). Every counter is an atomic store.incr,
 * never a read-modify-write of the session JSON, so concurrent requests cannot
 * share one count:
 *   - 5 code attempts per SESSION, never reset — not by a new code, not by
 *     picking another chat. The counter is checked before the session status,
 *     so a stale session write cannot revive a dead session;
 *   - 3 chats parked (= codes sent) per session, then the session fails;
 *   - @username lookups: 5 per session and 20 per web user per hour, refused
 *     while a code is pending, and a failed lookup never DMs the Telegram
 *     user (the web user typed the name, not them);
 *   - a park whose code DM was not delivered fails (no undeliverable code).
 *
 * Updates are re-checked with Telegram before they change stored data
 * (my_chat_member → getChatMember; migrate → getChat on the old id), so a
 * forged update cannot revoke or move a connection.
 *
 * "This wasn't me" is sticky: onDeny also claims a tombstone key
 * (social:tg-denied:<session>) for the session's remaining life. A park, share,
 * lookup or confirm already in flight checks it before it sends a code or
 * saves, and save() never writes a denied session back to life.
 *
 * Privacy: allowed_updates is message + my_chat_member + callback_query (the
 * "This wasn't me" button, its data is only the session id); messages outside
 * the bot's private chat are ignored except the group→supergroup migration
 * notice. No message text is stored.
 */

import * as crypto from 'crypto';

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { memberCanPost } from '../adapters/telegram.adapter';
import { OAUTH_STORE, type OAuthStore } from '../oauth-store';
import { SocialConnectionsService } from '../social-connections.service';

import {
  TelegramBotClient,
  telegramDevSettingsAllowed,
  type TgAdministratorRights,
  type TgChat,
  type TgCallbackQuery,
  type TgChatMemberUpdated,
  type TgMessage,
  type TgUpdate,
} from './telegram-bot.client';
import { telegramText, type TelegramLang } from './telegram-messages';

export const TG_SESSION_TTL_MS = 10 * 60 * 1000;
export const TG_CONFIRM_MAX_ATTEMPTS = 5;
export const TG_MAX_PARKS_PER_SESSION = 3;
export const TG_USERNAME_LOOKUPS_PER_SESSION = 5;
export const TG_USERNAME_LOOKUPS_PER_USER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const UPDATE_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000; // Telegram keeps updates ≤ 24 h

export type TelegramSessionStatus = 'waiting' | 'started' | 'pending_confirm' | 'connected' | 'failed';

/** Stable codes for the web to localise. */
export type TelegramConnectErrorCode =
  | 'bot_not_admin'
  | 'user_not_admin'
  | 'chat_not_found'
  | 'not_a_channel_or_group'
  | 'telegram_unavailable'
  | 'too_many_attempts';

/** What the session can end with: a connect problem, or the Telegram user pressed "This wasn't me". */
export type TelegramSessionError = TelegramConnectErrorCode | 'denied' | 'too_many_codes';

type ChatType = 'channel' | 'group' | 'supergroup';

interface SessionRecord {
  id: string;
  userId: string;
  workspaceId: string;
  nonce: string;
  expiresAt: string;
  status: TelegramSessionStatus;
  requestIds: { channel: number; group: number };
  telegramUserId?: number;
  lang?: TelegramLang;
  pending?: { chatId: string; chatType: ChatType; title?: string; username?: string };
  codeHash?: string;
  error?: TelegramSessionError;
  connectionId?: string;
}

export interface TelegramSessionView {
  sessionId: string;
  status: TelegramSessionStatus;
  expiresAt: string;
  /** True once someone tapped Start in Telegram with this session's link. */
  telegramLinked: boolean;
  /** Last problem; with status `started` the user can pick a chat again. */
  error?: TelegramSessionError;
  /** Code attempts left in this session (never reset), while pending_confirm. */
  attemptsLeft?: number;
  /** Only once connected. Chat details are not shown before the code is entered. */
  connection?: { id: string; accountName: string; chatType: ChatType; username?: string };
}

const sessionKey = (id: string) => `social:tg-session:${id}`;
const nonceKey = (nonce: string) => `social:tg-nonce:${nonce}`;
const userKey = (telegramUserId: number) => `social:tg-user:${telegramUserId}`;
const updateKey = (updateId: number) => `social:tg-update:${updateId}`;
const attemptsKey = (sessionId: string) => `social:tg-attempts:${sessionId}`;
const parksKey = (sessionId: string) => `social:tg-parks:${sessionId}`;
const lookupsKey = (sessionId: string) => `social:tg-lookups:${sessionId}`;
const userLookupsKey = (userId: string) => `social:tg-user-lookups:${userId}`;
const deniedKey = (sessionId: string) => `social:tg-denied:${sessionId}`;
const DENY_PREFIX = 'deny:';

const RIGHTS_NONE: TgAdministratorRights = {
  is_anonymous: false,
  can_manage_chat: false,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
};
/** The least a channel admin needs to post. Telegram grants the bot exactly this. */
const RIGHTS_POST: TgAdministratorRights = { ...RIGHTS_NONE, can_post_messages: true };
const RIGHTS_GROUP_ADMIN: TgAdministratorRights = { ...RIGHTS_NONE, can_manage_chat: true };

const err = (status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: status, code, message, ...extra }, status);

/** ۰-۹ and ٠-٩ → 0-9, whitespace removed. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, '');
}

/** "@name", "name", "t.me/name", "https://t.me/name" → "name", or null if not a valid public username. */
export function parseTelegramUsername(input: string): string | null {
  const raw = String(input ?? '').trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/\/+$/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(raw) ? raw : null;
}

@Injectable()
export class TelegramConnectService {
  private readonly logger = new Logger(TelegramConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: SocialConnectionsService,
    private readonly client: TelegramBotClient,
    @Inject(OAUTH_STORE) private readonly store: OAuthStore,
  ) {}

  // ─── Configuration ─────────────────────────────────────────────────────────

  /** Env vars this deployment is missing for Telegram. Empty means ready. */
  missingConfig(): string[] {
    const missing: string[] = [];
    if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) missing.push('TELEGRAM_BOT_TOKEN');
    if (!this.botUsername()) missing.push('TELEGRAM_BOT_USERNAME');
    // Polling is dev-only: production always needs the webhook secret.
    const polling = process.env.TELEGRAM_UPDATES_MODE?.trim() === 'polling' && telegramDevSettingsAllowed();
    if (!polling && !process.env.TELEGRAM_WEBHOOK_SECRET?.trim()) {
      missing.push('TELEGRAM_WEBHOOK_SECRET');
    }
    return missing;
  }

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  private botUsername(): string | undefined {
    return process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || undefined;
  }

  /** Constant-time check of X-Telegram-Bot-Api-Secret-Token. Fails closed when the env is unset. */
  checkWebhookSecret(header: string | undefined): boolean {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!expected || typeof header !== 'string' || !header) return false;
    const a = crypto.createHash('sha256').update(header).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // ─── Web side ──────────────────────────────────────────────────────────────

  async createSession(workspaceId: string, userId: string): Promise<{ sessionId: string; deepLink: string; expiresAt: string }> {
    if (!workspaceId) throw err(HttpStatus.BAD_REQUEST, 'workspace_required', 'workspaceId is required.');
    await this.connections.validateWorkspaceAccess(workspaceId, userId);
    const missing = this.missingConfig();
    if (missing.length) {
      this.logger.error(`Telegram connect blocked: missing ${missing.join(', ')}`);
      throw new ServiceUnavailableException({ code: 'telegram_not_configured', message: 'Telegram is not set up on this deployment.' });
    }

    const session: SessionRecord = {
      id: crypto.randomBytes(16).toString('base64url'),
      userId,
      workspaceId,
      nonce: crypto.randomBytes(16).toString('base64url'),
      expiresAt: new Date(Date.now() + TG_SESSION_TTL_MS).toISOString(),
      status: 'waiting',
      requestIds: { channel: this.requestId(), group: this.requestId() },
    };
    if (session.requestIds.group === session.requestIds.channel) session.requestIds.group ^= 1;

    try {
      await this.store.put(sessionKey(session.id), JSON.stringify(session), TG_SESSION_TTL_MS);
      await this.store.put(nonceKey(session.nonce), session.id, TG_SESSION_TTL_MS);
    } catch (e) {
      this.logger.error(`Telegram connect store unavailable: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ code: 'store_unavailable', message: 'Connecting is unavailable right now. Try again in a minute.' });
    }
    this.logger.log(`Telegram connect session created: workspace=${workspaceId}`);
    return {
      sessionId: session.id,
      deepLink: `https://t.me/${this.botUsername()}?start=${session.nonce}`,
      expiresAt: session.expiresAt,
    };
  }

  async getSession(id: string, userId: string): Promise<TelegramSessionView> {
    const session = await this.ownSession(id, userId);
    // A park that lost the race to a deny is shown (and rewritten) as denied.
    if (session.status !== 'connected' && session.error !== 'denied' && (await this.isDenied(session))) await this.save(session);
    return this.view(session, await this.attemptsUsed(session));
  }

  async confirm(id: string, userId: string, code: string): Promise<TelegramSessionView> {
    const session = await this.ownSession(id, userId);
    // The counter, not the session JSON, decides: a stale write cannot revive a dead session.
    if ((await this.attemptsUsed(session)) >= TG_CONFIRM_MAX_ATTEMPTS) return this.tooManyAttempts(session);
    // The deny tombstone, not the session JSON: a stale park cannot bring back a denied session.
    if (await this.isDenied(session)) throw this.sessionFinished('denied');
    if (session.status !== 'pending_confirm' || !session.pending || !session.codeHash) {
      throw err(HttpStatus.CONFLICT, 'not_pending', 'There is no chat waiting for confirmation in this session.', { status: session.status });
    }

    // Counted before the code is compared, atomically: concurrent confirms each get their own number.
    const attempt = await this.bump(attemptsKey(session.id), this.ttlLeft(session));
    if (attempt > TG_CONFIRM_MAX_ATTEMPTS) return this.tooManyAttempts(session);
    if (!this.codeMatches(session, normalizeDigits(String(code ?? '')))) {
      const left = TG_CONFIRM_MAX_ATTEMPTS - attempt;
      if (left <= 0) return this.tooManyAttempts(session);
      throw err(HttpStatus.BAD_REQUEST, 'wrong_code', 'That code is not right. Check the latest message from the bot.', { attemptsLeft: left });
    }

    await this.connections.validateWorkspaceAccess(session.workspaceId, userId);

    const { pending } = session;
    // Rights may have changed since the chat was shared.
    const bot = await this.client.getBotIdentity();
    const member = bot.ok ? await this.client.getChatMember(pending.chatId, bot.result.id) : bot;
    if (!member.ok) {
      if (member.kind === 'revoked') return this.backToStarted(session, 'bot_not_admin');
      throw err(HttpStatus.SERVICE_UNAVAILABLE, 'telegram_unavailable', 'Telegram could not be reached. Try again in a minute.');
    }
    if (!memberCanPost(member.result, pending.chatType)) return this.backToStarted(session, 'bot_not_admin');
    // "This wasn't me" may have landed while Telegram was being asked.
    if (await this.isDenied(session)) throw this.sessionFinished('denied');

    const hasDefault = await this.prisma.socialConnection.findFirst({
      where: { workspaceId: session.workspaceId, platform: 'TELEGRAM', status: 'CONNECTED', isDefault: true, accountIdentifier: { not: pending.chatId } },
      select: { id: true },
    });
    const meta = {
      chatType: pending.chatType,
      ...(pending.title && { title: pending.title }),
      ...(pending.username && { username: pending.username }),
      linkedByTelegramUserId: session.telegramUserId,
    };
    const connection = await this.connections.create({
      workspaceId: session.workspaceId,
      platform: 'TELEGRAM',
      accountName: pending.title || (pending.username ? `@${pending.username}` : pending.chatId),
      accountIdentifier: pending.chatId,
      authProvider: 'telegram_bot',
      meta,
      scopes: pending.chatType === 'channel' ? ['can_post_messages'] : ['can_send_messages'],
      isDefault: !hasDefault,
    });

    session.status = 'connected';
    session.connectionId = connection.id;
    session.codeHash = undefined;
    session.error = undefined;
    await this.save(session);
    if (session.telegramUserId) await this.safeDel(userKey(session.telegramUserId));
    await this.safeDel(nonceKey(session.nonce));

    if (session.telegramUserId) {
      await this.say(session.telegramUserId, telegramText(session.lang, 'connected', { title: connection.accountName }));
    }
    this.logger.log(`Telegram connected: workspace=${session.workspaceId} chatType=${pending.chatType}`);
    return this.view(session, attempt);
  }

  /** Marks the session failed (idempotent) and throws 429. */
  private async tooManyAttempts(session: SessionRecord): Promise<never> {
    if (session.status !== 'failed' || session.error !== 'too_many_attempts') {
      session.status = 'failed';
      session.error = 'too_many_attempts';
      session.pending = undefined;
      session.codeHash = undefined;
      await this.save(session);
      this.logger.warn(`Telegram connect session failed: too many attempts (workspace=${session.workspaceId})`);
    }
    throw err(HttpStatus.TOO_MANY_REQUESTS, 'too_many_attempts', this.problemMessage('too_many_attempts'));
  }

  /** Fallback for a public channel/group: the user names it instead of picking it in Telegram. */
  async connectByUsername(id: string, userId: string, input: string): Promise<TelegramSessionView> {
    const session = await this.ownSession(id, userId);
    if (await this.isDenied(session)) throw this.sessionFinished('denied');
    if (session.status === 'pending_confirm') {
      // A new park would send the Telegram user another code; one pending code at a time.
      throw err(HttpStatus.CONFLICT, 'already_pending', 'A chat is already waiting for its code. Enter the code from the bot, or start again.');
    }
    if (session.status === 'failed' || session.status === 'connected') {
      throw err(HttpStatus.CONFLICT, 'session_finished', 'This Telegram connection attempt is over. Start again.', { status: session.status, ...(session.error && { error: session.error }) });
    }
    if (!session.telegramUserId || session.status !== 'started') {
      throw err(HttpStatus.CONFLICT, 'start_bot_first', 'Open the bot link and tap Start first, so we know your Telegram account.');
    }
    const username = parseTelegramUsername(input);
    if (!username) throw err(HttpStatus.BAD_REQUEST, 'invalid_username', 'Enter the public @username of the channel or group.');

    // Each lookup makes Telegram calls about someone's chat; bound them per session and per user.
    const [perSession, perUser] = await Promise.all([
      this.bump(lookupsKey(session.id), this.ttlLeft(session)),
      this.bump(userLookupsKey(userId), HOUR_MS),
    ]);
    if (perSession > TG_USERNAME_LOOKUPS_PER_SESSION || perUser > TG_USERNAME_LOOKUPS_PER_USER_HOUR) {
      this.logger.warn(`Telegram @username lookups limited (workspace=${session.workspaceId}, session=${perSession}, user/h=${perUser})`);
      throw err(HttpStatus.TOO_MANY_REQUESTS, 'too_many_lookups', 'Too many channel lookups. Wait a while, or pick the chat in Telegram instead.');
    }

    const chat = await this.client.getChat(`@${username}`);
    if (!chat.ok) {
      if (chat.kind === 'revoked' || chat.kind === 'bad_request') {
        throw err(HttpStatus.NOT_FOUND, 'chat_not_found', 'Telegram has no public channel or group with that username, or the bot is not in it.');
      }
      throw err(HttpStatus.SERVICE_UNAVAILABLE, 'telegram_unavailable', 'Telegram could not be reached. Try again in a minute.');
    }
    if (chat.result.type === 'private') {
      throw err(HttpStatus.BAD_REQUEST, 'not_a_channel_or_group', 'That username belongs to a person or bot, not a channel or group.');
    }
    // notify=false: the web user typed this name, so failures go to the web, never to the Telegram user's DM.
    const problem = await this.verifyAndPark(session, chat.result, { notify: false });
    if (problem === 'too_many_codes') throw err(HttpStatus.TOO_MANY_REQUESTS, problem, 'Too many codes were sent in this connection attempt. Start again.');
    if (problem === 'denied') throw this.sessionFinished('denied');
    if (problem === 'too_many_attempts') throw err(HttpStatus.TOO_MANY_REQUESTS, problem, this.problemMessage(problem));
    if (problem) throw err(HttpStatus.CONFLICT, problem, this.problemMessage(problem));
    return this.view(session, await this.attemptsUsed(session));
  }

  // ─── Telegram side ─────────────────────────────────────────────────────────

  /** One entry point for webhook and polling. Never throws. */
  async handleUpdate(update: TgUpdate): Promise<void> {
    try {
      if (typeof update?.update_id !== 'number') return;
      const handler = this.route(update);
      // Only updates we act on claim their id: ignored traffic writes nothing to the store.
      if (!handler) return;
      if (!(await this.firstTime(update.update_id))) return;
      await handler();
    } catch (e) {
      this.logger.error(`Telegram update ${update?.update_id} failed: ${(e as Error).message}`);
    }
  }

  /** The handler for an update we act on, or null to ignore it. */
  private route(update: TgUpdate): (() => Promise<unknown>) | null {
    const member = update.my_chat_member;
    if (member?.chat) return () => this.onMyChatMember(member);
    const callback = update.callback_query;
    if (callback?.from && typeof callback.data === 'string' && callback.data.startsWith(DENY_PREFIX)) {
      return () => this.onDeny(callback);
    }
    const msg = update.message;
    if (!msg?.chat) return null;
    const migrateTo = msg.migrate_to_chat_id;
    if (typeof migrateTo === 'number') return () => this.onMigrated(msg.chat.id, migrateTo);
    // Only the bot's private chat is read. Never customers' groups/channels.
    if (msg.chat.type !== 'private' || !msg.from) return null;
    if (msg.chat_shared) return () => this.onChatShared(msg);
    if (typeof msg.text === 'string' && /^\/start(@\w+)?(\s|$)/.test(msg.text)) return () => this.onStart(msg);
    return null;
  }

  /**
   * "This wasn't me": the Telegram user who opened the link ends the session.
   * Only that Telegram user, and only before it is connected. The button sits
   * on the code message.
   */
  private async onDeny(callback: TgCallbackQuery) {
    const sessionId = callback.data!.slice(DENY_PREFIX.length);
    const session = /^[A-Za-z0-9_-]{1,64}$/.test(sessionId) ? await this.load(sessionId) : null;
    const answer = () => this.client.answerCallbackQuery(callback.id).then((r) => {
      if (!r.ok) this.logger.warn(`Telegram answerCallbackQuery failed: ${r.description}`);
    });
    if (!session || session.telegramUserId !== callback.from.id || session.status === 'connected' || session.status === 'failed') {
      return answer();
    }
    // The tombstone first: whatever is in flight sees it, even if the save below is overwritten.
    try {
      await this.store.claimOnce(deniedKey(session.id), this.ttlLeft(session));
    } catch (e) {
      this.logger.error(`Telegram deny tombstone not written: ${(e as Error).message}`);
    }
    session.status = 'failed';
    session.error = 'denied';
    session.pending = undefined;
    session.codeHash = undefined;
    await this.save(session);
    await this.safeDel(userKey(callback.from.id));
    await this.safeDel(nonceKey(session.nonce));
    this.logger.warn(`Telegram connect session denied by the Telegram user (workspace=${session.workspaceId})`);
    await answer();
    await this.say(callback.from.id, telegramText(session.lang, 'denied'));
  }

  private async onStart(msg: TgMessage) {
    const from = msg.from!;
    const lang = telegramLangOf(from.language_code);
    const nonce = msg.text!.split(/\s+/)[1];
    if (!nonce) return this.say(from.id, telegramText(lang, 'help'));

    const sessionId = /^[A-Za-z0-9_-]{1,64}$/.test(nonce) ? await this.store.get(nonceKey(nonce)) : null;
    const session = sessionId ? await this.load(sessionId) : null;
    if (!session || session.status === 'connected' || session.status === 'failed') {
      return this.say(from.id, telegramText(lang, 'expired'));
    }
    if (session.telegramUserId && session.telegramUserId !== from.id) {
      this.logger.warn(`Telegram connect: second Telegram account tried a bound link (workspace=${session.workspaceId})`);
      return this.say(from.id, telegramText(lang, 'expired'));
    }

    session.telegramUserId = from.id;
    session.lang = lang;
    if (session.status === 'waiting') session.status = 'started';
    await this.save(session);
    await this.store.put(userKey(from.id), session.id, this.ttlLeft(session));

    const workspace = await this.prisma.workspace.findUnique({ where: { id: session.workspaceId }, select: { name: true } });
    await this.client.sendMessage({
      chat_id: from.id,
      text: telegramText(lang, 'choose', { workspace: workspace?.name ?? '' }),
      reply_markup: {
        keyboard: [
          [{ text: telegramText(lang, 'buttonChannel'), request_chat: {
            request_id: session.requestIds.channel,
            chat_is_channel: true,
            user_administrator_rights: RIGHTS_POST,
            bot_administrator_rights: RIGHTS_POST,
            request_title: true,
            request_username: true,
          } }],
          [{ text: telegramText(lang, 'buttonGroup'), request_chat: {
            request_id: session.requestIds.group,
            chat_is_channel: false,
            // Telegram rejects an all-false rights object (ADMIN_RIGHTS_EMPTY,
            // seen live 22 Nov), so ask for the basic admin right on both sides.
            user_administrator_rights: RIGHTS_GROUP_ADMIN,
            bot_administrator_rights: RIGHTS_GROUP_ADMIN,
            request_title: true,
            request_username: true,
          } }],
        ],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    }).then((r) => {
      if (!r.ok) this.logger.warn(`Telegram /start reply failed: ${r.description}`);
    });
  }

  private async onChatShared(msg: TgMessage) {
    const from = msg.from!;
    const shared = msg.chat_shared!;
    const sessionId = await this.store.get(userKey(from.id));
    const session = sessionId ? await this.load(sessionId) : null;
    if (!session || session.telegramUserId !== from.id) return;
    if (session.status !== 'started' && session.status !== 'pending_confirm') return;
    const { channel, group } = session.requestIds;
    if (shared.request_id !== channel && shared.request_id !== group) return;
    if (await this.isDenied(session)) return;

    const chat = await this.client.getChat(shared.chat_id);
    const info: TgChat = chat.ok
      ? chat.result
      : { id: shared.chat_id, type: shared.request_id === channel ? 'channel' : 'supergroup', title: shared.title, username: shared.username };
    await this.verifyAndPark(session, info, { notify: true });
  }

  /**
   * Bot and sharing user must both be able to post. On success the chat is
   * parked (pending_confirm) and the code is sent; returns null. On failure
   * the session stays `started` with an error the web shows; the user can pick
   * again. Nothing is saved here.
   *
   * At most TG_MAX_PARKS_PER_SESSION codes are sent per session; past that the
   * session fails (too_many_attempts). The code is stored only once Telegram
   * accepted the DM carrying it. `notify` = tell the Telegram user about a
   * failure (only when they picked the chat themselves).
   */
  private async verifyAndPark(session: SessionRecord, chat: TgChat, opts: { notify: boolean }): Promise<TelegramSessionError | null> {
    const lang = session.lang;
    const telegramUserId = session.telegramUserId!;
    const fail = (code: TelegramConnectErrorCode, title?: string) => this.fail(session, code, title, opts.notify);
    if ((await this.attemptsUsed(session)) >= TG_CONFIRM_MAX_ATTEMPTS) return this.failSession(session, 'too_many_attempts');
    const chatType: ChatType | null = chat.type === 'private' ? null : chat.type;
    if (!chatType) return fail('not_a_channel_or_group');

    const bot = await this.client.getBotIdentity();
    if (!bot.ok) return fail('telegram_unavailable');
    const [botMember, userMember] = await Promise.all([
      this.client.getChatMember(chat.id, bot.result.id),
      this.client.getChatMember(chat.id, telegramUserId),
    ]);
    if (!botMember.ok) return fail(botMember.kind === 'revoked' ? 'bot_not_admin' : 'telegram_unavailable', chat.title);
    if (!memberCanPost(botMember.result, chatType)) return fail('bot_not_admin', chat.title);
    if (!userMember.ok) return fail(userMember.kind === 'revoked' ? 'user_not_admin' : 'telegram_unavailable', chat.title);
    const userIsAdmin =
      userMember.result.status === 'creator' ||
      (userMember.result.status === 'administrator' && (chatType !== 'channel' || userMember.result.can_post_messages === true));
    if (!userIsAdmin) return fail('user_not_admin', chat.title);

    const parks = await this.bump(parksKey(session.id), this.ttlLeft(session));
    if (parks > TG_MAX_PARKS_PER_SESSION) return this.failSession(session, 'too_many_codes');

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    // Names the workspace and the chat, so a tricked user sees whose request this is,
    // and offers "This wasn't me" (one reply_markup per message: the inline button
    // replaces remove_keyboard; the request_chat keyboard is one_time and folds itself).
    const workspace = await this.prisma.workspace.findUnique({ where: { id: session.workspaceId }, select: { name: true } });
    // "This wasn't me" may have landed while Telegram was being asked: no code after a deny.
    if (await this.isDenied(session)) return 'denied';
    const sent = await this.client.sendMessage({
      chat_id: telegramUserId,
      text: telegramText(lang, 'code', {
        title: chat.title ?? (chat.username ? `@${chat.username}` : ''),
        workspace: workspace?.name ?? '',
        code,
      }),
      reply_markup: { inline_keyboard: [[{ text: telegramText(lang, 'buttonNotMe'), callback_data: `${DENY_PREFIX}${session.id}` }]] },
    });
    if (!sent.ok) {
      // No code nobody can read: the web shows the error, the user can try again.
      this.logger.warn(`Telegram code message failed: ${sent.description}`);
      return this.fail(session, 'telegram_unavailable', chat.title, false);
    }
    // …or while the code was on its way: never save pending_confirm over the deny.
    if (await this.isDenied(session)) return 'denied';

    session.status = 'pending_confirm';
    session.pending = {
      chatId: String(chat.id),
      chatType,
      ...(chat.title && { title: chat.title }),
      ...(chat.username && { username: chat.username }),
    };
    session.codeHash = this.hashCode(session.id, code);
    session.error = undefined;
    await this.save(session);
    return null;
  }

  private async fail(session: SessionRecord, code: TelegramConnectErrorCode, title?: string, notify = true): Promise<TelegramConnectErrorCode> {
    session.status = 'started';
    session.error = code;
    session.pending = undefined;
    session.codeHash = undefined;
    await this.save(session);
    if (notify && session.telegramUserId) {
      await this.say(session.telegramUserId, telegramText(session.lang, code, { title: title ?? '' }));
    }
    return code;
  }

  /** The session is over (too many codes sent, or too many attempts). Nothing is DMed. */
  private async failSession(session: SessionRecord, reason: 'too_many_attempts' | 'too_many_codes'): Promise<TelegramSessionError> {
    session.status = 'failed';
    session.error = reason;
    session.pending = undefined;
    session.codeHash = undefined;
    await this.save(session);
    this.logger.warn(`Telegram connect session failed: ${reason} (workspace=${session.workspaceId})`);
    return reason;
  }

  private async backToStarted(session: SessionRecord, code: TelegramConnectErrorCode): Promise<never> {
    await this.fail(session, code, session.pending?.title);
    throw err(HttpStatus.CONFLICT, code, this.problemMessage(code));
  }

  /**
   * The bot was removed or lost its rights → every connection to that chat is
   * REVOKED at once. The update is not trusted on its own: Telegram is asked
   * (getChatMember for the bot) before anything changes.
   */
  private async onMyChatMember(update: TgChatMemberUpdated) {
    if (update.chat.type === 'private') return; // the user blocked the bot's DM; not a connection
    const chatType = update.chat.type;
    if (memberCanPost(update.new_chat_member, chatType)) return;

    const rows = await this.prisma.socialConnection.findMany({
      where: { platform: 'TELEGRAM', accountIdentifier: String(update.chat.id), status: 'CONNECTED' },
      select: { id: true, metaJson: true },
    });
    if (!rows.length) return; // not ours: no Telegram call spent on it

    const bot = await this.client.getBotIdentity();
    const live = bot.ok ? await this.client.getChatMember(update.chat.id, bot.result.id) : bot;
    let reason: 'BOT_REMOVED' | 'BOT_RIGHTS_LOST';
    if (live.ok) {
      if (memberCanPost(live.result, chatType)) {
        this.logger.warn('Telegram my_chat_member says the bot lost a chat, but Telegram says it can still post; ignored');
        return;
      }
      reason = live.result.status === 'left' || live.result.status === 'kicked' ? 'BOT_REMOVED' : 'BOT_RIGHTS_LOST';
    } else if (live.kind === 'revoked') {
      reason = 'BOT_REMOVED';
    } else {
      // Unconfirmed: leave the rows; the next publish health check finds a real loss.
      this.logger.warn(`Telegram my_chat_member not confirmed (${live.kind}); connections left as they are`);
      return;
    }

    for (const row of rows) {
      const meta = { ...((row.metaJson as Record<string, unknown> | null) ?? {}), revokedReason: reason, revokedAt: new Date().toISOString() };
      await this.prisma.socialConnection.updateMany({
        where: { id: row.id, status: 'CONNECTED' },
        data: { status: 'REVOKED', metaJson: meta as Prisma.InputJsonValue },
      });
    }
    this.logger.warn(`Telegram ${reason}: ${rows.length} connection(s) marked REVOKED`);
  }

  /** Group → supergroup. Rewritten only when Telegram confirms the old id moved to exactly this one. */
  private async onMigrated(oldChatId: number, newChatId: number) {
    const check = await this.client.getChat(oldChatId);
    if (check.ok || check.kind !== 'migrated' || check.migrateToChatId !== newChatId) {
      this.logger.warn(`Telegram migrate notice not confirmed by getChat (${check.ok ? 'chat not migrated' : check.kind}); ignored`);
      return;
    }
    const rows = await this.prisma.socialConnection.findMany({
      where: { platform: 'TELEGRAM', accountIdentifier: String(oldChatId), status: { in: ['CONNECTED', 'EXPIRED'] } },
      select: { id: true, metaJson: true },
    });
    for (const row of rows) {
      const meta = { ...((row.metaJson as Record<string, unknown> | null) ?? {}), chatType: 'supergroup' };
      await this.prisma.socialConnection.update({
        where: { id: row.id },
        data: { accountIdentifier: String(newChatId), metaJson: meta as Prisma.InputJsonValue },
      });
    }
    if (rows.length) this.logger.log(`Telegram group upgraded: ${rows.length} connection(s) moved to the new chat id`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private requestId(): number {
    return crypto.randomInt(1, 2 ** 31 - 1); // signed 32-bit, > 0
  }

  private hashCode(sessionId: string, code: string): string {
    return crypto.createHash('sha256').update(`${sessionId}:${code}`).digest('base64url');
  }

  private codeMatches(session: SessionRecord, code: string): boolean {
    if (!/^\d{6}$/.test(code) || !session.codeHash) return false;
    const a = Buffer.from(this.hashCode(session.id, code));
    const b = Buffer.from(session.codeHash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** 404 for a missing session AND for someone else's: never confirm another user's session exists. */
  private async ownSession(id: string, userId: string): Promise<SessionRecord> {
    const session = typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await this.load(id) : null;
    if (!session || session.userId !== userId) {
      throw new NotFoundException({ code: 'session_not_found', message: 'This Telegram connection attempt expired. Start again.' });
    }
    return session;
  }

  private async load(id: string): Promise<SessionRecord | null> {
    let raw: string | null;
    try {
      raw = await this.store.get(sessionKey(id));
    } catch (e) {
      this.logger.error(`Telegram connect store unavailable: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ code: 'store_unavailable', message: 'Connecting is unavailable right now. Try again in a minute.' });
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  private ttlLeft(session: SessionRecord): number {
    return Math.max(1000, new Date(session.expiresAt).getTime() - Date.now());
  }

  /**
   * Writes the session. A denied session (tombstone) is always written as
   * failed/denied, whatever the caller had in memory, unless it is already
   * connected (a confirm that won the race; the deny refused it).
   */
  private async save(session: SessionRecord) {
    if (session.status !== 'connected' && !(session.status === 'failed' && session.error === 'denied') && (await this.isDenied(session))) {
      session.status = 'failed';
      session.error = 'denied';
      session.pending = undefined;
      session.codeHash = undefined;
    }
    await this.store.put(sessionKey(session.id), JSON.stringify(session), this.ttlLeft(session));
  }

  /** True once the Telegram user pressed "This wasn't me". A store failure is a 503, never "not denied". */
  private async isDenied(session: SessionRecord): Promise<boolean> {
    try {
      return (await this.store.get(deniedKey(session.id))) !== null;
    } catch (e) {
      this.logger.error(`Telegram connect store unavailable: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ code: 'store_unavailable', message: 'Connecting is unavailable right now. Try again in a minute.' });
    }
  }

  private sessionFinished(error: TelegramSessionError): HttpException {
    return err(HttpStatus.CONFLICT, 'session_finished', 'This Telegram connection attempt is over. Start again.', { status: 'failed', error });
  }

  private async safeDel(key: string) {
    try {
      await this.store.del(key);
    } catch (e) {
      this.logger.warn(`Telegram connect: could not delete a session key: ${(e as Error).message}`);
    }
  }

  /** Atomic +1 on a counter key. A store failure is a 503, never "no limit". */
  private async bump(key: string, ttlMs: number): Promise<number> {
    try {
      return await this.store.incr(key, ttlMs);
    } catch (e) {
      this.logger.error(`Telegram connect store unavailable: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ code: 'store_unavailable', message: 'Connecting is unavailable right now. Try again in a minute.' });
    }
  }

  /** Code attempts used in this session so far (all parks together). */
  private async attemptsUsed(session: SessionRecord): Promise<number> {
    let raw: string | null;
    try {
      raw = await this.store.get(attemptsKey(session.id));
    } catch (e) {
      this.logger.error(`Telegram connect store unavailable: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ code: 'store_unavailable', message: 'Connecting is unavailable right now. Try again in a minute.' });
    }
    const n = Number(raw ?? 0);
    return Number.isFinite(n) ? n : TG_CONFIRM_MAX_ATTEMPTS;
  }

  /** True the first time an update id is seen. A store error lets it through (handlers are idempotent). */
  private async firstTime(updateId: number): Promise<boolean> {
    try {
      return await this.store.claimOnce(updateKey(updateId), UPDATE_DEDUPE_TTL_MS);
    } catch (e) {
      this.logger.warn(`Telegram update dedupe unavailable: ${(e as Error).message}`);
      return true;
    }
  }

  private async say(chatId: number, text: string) {
    const r = await this.client.sendMessage({ chat_id: chatId, text });
    if (!r.ok) this.logger.warn(`Telegram bot reply failed: ${r.description}`);
  }

  private problemMessage(code: TelegramConnectErrorCode): string {
    switch (code) {
      case 'bot_not_admin': return 'The Contivo bot is not an admin that can post in that chat.';
      case 'user_not_admin': return 'Your Telegram account must be an admin who can post in that chat.';
      case 'chat_not_found': return 'Telegram could not find that chat.';
      case 'not_a_channel_or_group': return 'Pick a channel or a group.';
      case 'telegram_unavailable': return 'Telegram could not be reached. Try again in a minute.';
      case 'too_many_attempts': return 'Too many wrong codes. Start the Telegram connection again.';
    }
  }

  private view(s: SessionRecord, attemptsUsed: number): TelegramSessionView {
    return {
      sessionId: s.id,
      status: s.status,
      expiresAt: s.expiresAt,
      telegramLinked: !!s.telegramUserId,
      ...(s.error && { error: s.error }),
      ...(s.status === 'pending_confirm' && { attemptsLeft: Math.max(0, TG_CONFIRM_MAX_ATTEMPTS - attemptsUsed) }),
      ...(s.status === 'connected' && s.connectionId && s.pending && {
        connection: {
          id: s.connectionId,
          accountName: s.pending.title || (s.pending.username ? `@${s.pending.username}` : s.pending.chatId),
          chatType: s.pending.chatType,
          ...(s.pending.username && { username: s.pending.username }),
        },
      }),
    };
  }
}

export function telegramLangOf(code: string | undefined): TelegramLang {
  return code?.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}
