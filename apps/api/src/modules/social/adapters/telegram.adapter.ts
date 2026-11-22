/**
 * telegram.adapter.ts
 *
 * Publishes to a Telegram channel or group through the one Contivo bot
 * (credential in TELEGRAM_BOT_TOKEN; the connection row holds no secret).
 *
 * connection.accountIdentifier = String(chat_id). meta = { chatType, title,
 * username?, linkedByTelegramUserId } written at connect time.
 *
 * Publish rules (spec 2026-11-21-publishing-channels-design.md §3):
 *   - markdown → Telegram HTML (telegram-format.ts), parse_mode HTML;
 *   - ≤ 3,800 visible chars per message, cut between blocks; ≥ 1 s between
 *     messages (Telegram: no more than one message per second per chat);
 *   - image: whole post ≤ 1,024 chars → one sendPhoto with caption, else the
 *     photo first and then the text (previews off, the photo is the visual);
 *   - every delivered part is recorded through PublishContext with the
 *     sha256 of what was sent, and a retry skips parts already delivered — a
 *     failure on part 3 never re-posts 1-2. If the post was edited between
 *     attempts (a delivered part's hash no longer matches), nothing is sent:
 *     non-retryable INVALID_CONTENT, because skipping would leave a mixed
 *     post and resending would duplicate it;
 *   - migrate_to_chat_id (group upgraded to supergroup) → store the new id,
 *     resend once.
 * Write-back: externalPostId "<chat_id>:<first message_id>"; URL
 * t.me/<username>/<id> (public) or t.me/c/<chat_id without -100>/<id>
 * (private; opens for members only. The -100 rule is ASSUMED until checked
 * on a real private channel).
 */

import * as crypto from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';

import {
  TelegramBotClient,
  type TelegramFailure,
  type TgChatMember,
  type TgMessage,
  type TelegramResult,
} from '../telegram/telegram-bot.client';

import type {
  AdapterConnection,
  ConnectionHealth,
  CredentialKind,
  PublishContext,
  PublishPayload,
  PublishResult,
  SentPart,
  SocialAdapter,
  ValidationResult,
} from './social-adapter.interface';
import { TELEGRAM_CAPTION_LIMIT, splitTelegramMessages, visibleLength } from './telegram-format';

/** Pause between two messages of one post. Telegram asks for ≤ 1 message/s per chat. */
export const TELEGRAM_PART_PAUSE_MS = 1100;
/** A post that needs more messages than this is refused before anything is sent. */
export const TELEGRAM_MAX_PARTS = 12;
/** sendPhoto upload limit. */
export const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

type ChatType = 'channel' | 'group' | 'supergroup';

type Part =
  | { kind: 'photo'; caption?: string }
  | { kind: 'text'; html: string; noPreview: boolean };

/** What a part's hash covers: the HTML sent, or for a photo the image bytes and caption. */
export type TelegramPartContent =
  | { kind: 'text'; html: string }
  | { kind: 'photo'; caption?: string; image?: Buffer };

/** sha256 (hex) of one part's content, stored with PART_SENT. */
export function telegramPartHash(part: TelegramPartContent): string {
  const h = crypto.createHash('sha256');
  if (part.kind === 'text') {
    h.update('text\0').update(part.html);
  } else {
    h.update('photo\0').update(crypto.createHash('sha256').update(part.image ?? Buffer.alloc(0)).digest('hex'));
    h.update('\0').update(part.caption ?? '');
  }
  return h.digest('hex');
}

/** Can the bot (as this chat member) post in a chat of this type? */
export function memberCanPost(member: TgChatMember, chatType: ChatType): boolean {
  if (member.status === 'creator') return true;
  if (chatType === 'channel') return member.status === 'administrator' && member.can_post_messages === true;
  if (member.status === 'administrator' || member.status === 'member') return true;
  if (member.status === 'restricted') return member.can_send_messages === true;
  return false;
}

/** Public: t.me/<username>/<id>. Private supergroup/channel: t.me/c/<id without -100>/<id>. */
export function telegramPostUrl(chatId: string, messageId: string, username?: string | null): string | undefined {
  if (username) return `https://t.me/${username}/${messageId}`;
  if (chatId.startsWith('-100')) return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  return undefined; // basic groups have no message links
}

function chatTypeOf(meta: Record<string, unknown> | undefined): ChatType | undefined {
  const t = meta?.chatType;
  return t === 'channel' || t === 'group' || t === 'supergroup' ? t : undefined;
}

/** The post text: body, then hashtags, then the link — kept at the end so a Persian bubble stays RTL. */
export function telegramPostMarkdown(payload: PublishPayload): string {
  const parts = [payload.body.trim()];
  const tags = (payload.hashtags ?? [])
    .map((t) => t.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/\s+/g, '_')}`);
  if (tags.length) parts.push(tags.join(' '));
  if (payload.linkUrl && !payload.body.includes(payload.linkUrl)) parts.push(payload.linkUrl);
  return parts.join('\n\n');
}

@Injectable()
export class TelegramAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'TELEGRAM';
  readonly credential: CredentialKind = 'platform_env';
  private readonly logger = new Logger(TelegramAdapter.name);

  /** Overridable in tests. */
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(private readonly client: TelegramBotClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async validateConnection(connection: AdapterConnection): Promise<ConnectionHealth> {
    const bot = await this.client.getBotIdentity();
    if (!bot.ok) return this.healthFromFailure(bot);

    let chatId: string | number = connection.accountIdentifier;
    let member = await this.client.getChatMember(chatId, bot.result.id);
    if (!member.ok && member.kind === 'migrated' && member.migrateToChatId) {
      // Publish stores the new id and posts there; check that chat now.
      chatId = member.migrateToChatId;
      member = await this.client.getChatMember(chatId, bot.result.id);
    }
    if (!member.ok) return this.healthFromFailure(member);

    let chatType = chatTypeOf(connection.meta);
    if (!chatType) {
      const chat = await this.client.getChat(chatId);
      if (!chat.ok) return this.healthFromFailure(chat);
      chatType = chat.result.type === 'private' ? 'group' : chat.result.type;
    }
    if (memberCanPost(member.result, chatType)) return { ok: true };

    return {
      ok: false,
      reason: 'revoked',
      detail:
        chatType === 'channel'
          ? 'The Contivo bot is no longer an admin who can post in this Telegram channel. Connect the channel again.'
          : 'The Contivo bot can no longer send messages in this Telegram group. Connect the group again.',
    };
  }

  private healthFromFailure(f: TelegramFailure): ConnectionHealth {
    switch (f.kind) {
      case 'revoked':
        return { ok: false, reason: 'revoked', detail: `${f.description}. Connect the channel again.` };
      case 'rate_limited':
        return { ok: false, reason: 'transient', detail: `${f.description} (429)`, retryAfterSec: f.retryAfterSec };
      case 'unauthorized':
        // Our bot token, not the customer's access: never mark their connection.
        this.logger.error('Telegram rejected the Contivo bot token (401). Check TELEGRAM_BOT_TOKEN on contivo-api.');
        return { ok: false, reason: 'transient', detail: 'Contivo\'s Telegram bot is misconfigured (token rejected).' };
      default:
        return { ok: false, reason: 'transient', detail: f.description };
    }
  }

  // ─── Payload ───────────────────────────────────────────────────────────────

  validatePayload(payload: PublishPayload): ValidationResult {
    const errors: string[] = [];
    if (!payload.body?.trim()) errors.push('Telegram post has no text.');
    else {
      const parts = splitTelegramMessages(telegramPostMarkdown(payload)).length;
      if (parts > TELEGRAM_MAX_PARTS) {
        errors.push(`The post is too long for Telegram: it would need ${parts} messages (at most ${TELEGRAM_MAX_PARTS}).`);
      }
    }
    if (payload.image && payload.image.data.length > TELEGRAM_PHOTO_MAX_BYTES) {
      errors.push('The image is larger than Telegram\'s 10 MB photo limit.');
    }
    return { valid: errors.length === 0, errors };
  }

  private plan(payload: PublishPayload): Part[] {
    const texts = splitTelegramMessages(telegramPostMarkdown(payload));
    if (!payload.image) return texts.map((html) => ({ kind: 'text', html, noPreview: false }));
    if (texts.length === 1 && visibleLength(texts[0]) <= TELEGRAM_CAPTION_LIMIT) {
      return [{ kind: 'photo', caption: texts[0] }];
    }
    return [{ kind: 'photo' }, ...texts.map((html): Part => ({ kind: 'text', html, noPreview: true }))];
  }

  // ─── Publish ───────────────────────────────────────────────────────────────

  async publish(connection: AdapterConnection, payload: PublishPayload, context?: PublishContext): Promise<PublishResult> {
    const validation = this.validatePayload(payload);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' '), retryable: false, failureCode: 'INVALID_CONTENT' };
    }
    const parts = this.plan(payload);
    const sent = context?.sentParts ?? new Map<number, SentPart>();
    const hashes = parts.map((part) =>
      telegramPartHash(part.kind === 'text' ? part : { kind: 'photo', caption: part.caption, image: payload.image?.data }));

    // Checked for every delivered part before anything is sent.
    for (const [index, done] of sent) {
      if (index >= parts.length || done.contentHash !== hashes[index]) {
        this.logger.warn(`Telegram post for connection ${connection.id} changed after part ${index + 1} was delivered; not sending`);
        return {
          success: false,
          retryable: false,
          failureCode: 'INVALID_CONTENT',
          error: `Post changed after partial delivery: part ${index + 1} is already in the Telegram chat with different content. Delete the posted parts in Telegram, then publish the post again as a new post.`,
        };
      }
    }

    const ids: string[] = [];
    let chatId = connection.accountIdentifier;
    let migrated = false;
    let sentThisRun = 0;

    for (let index = 0; index < parts.length; index++) {
      const already = sent.get(index);
      if (already) {
        ids[index] = already.externalId;
        continue;
      }
      if (sentThisRun > 0 || index > 0) await this.pause(TELEGRAM_PART_PAUSE_MS);

      let res = await this.send(chatId, parts[index], payload);
      if (!res.ok && res.kind === 'migrated' && res.migrateToChatId && !migrated) {
        migrated = true;
        chatId = String(res.migrateToChatId);
        try {
          await context?.updateAccountIdentifier(chatId);
        } catch (err) {
          this.logger.warn(`Could not store migrated Telegram chat id for connection ${connection.id}: ${(err as Error).message}`);
        }
        res = await this.send(chatId, parts[index], payload);
      }
      if (!res.ok) return this.publishFailure(res, index, parts.length, sentThisRun + sent.size);

      const messageId = String(res.result.message_id);
      ids[index] = messageId;
      sentThisRun += 1;
      try {
        await context?.recordPart(index, messageId, hashes[index]);
      } catch (err) {
        // The part is live but unrecorded: a retry would post it again. Stop here.
        this.logger.error(`Telegram part ${index + 1} sent but not recorded (connection ${connection.id}): ${(err as Error).message}`);
        return {
          success: false,
          retryable: false,
          failureCode: 'PLATFORM_ERROR',
          error: `Part ${index + 1} of ${parts.length} was posted to Telegram but could not be recorded. Check the channel before retrying.`,
        };
      }
    }

    const first = ids[0];
    const username = await this.currentUsername(chatId, connection.meta);
    return {
      success: true,
      externalPostId: `${chatId}:${first}`,
      externalPostUrl: telegramPostUrl(chatId, first, username),
    };
  }

  private send(chatId: string, part: Part, payload: PublishPayload): Promise<TelegramResult<TgMessage>> {
    if (part.kind === 'photo') {
      const image = payload.image!;
      return this.client.sendPhoto({
        chat_id: chatId,
        photo: { data: image.data, mimeType: image.mimeType, filename: `post.${image.mimeType.split('/')[1] ?? 'png'}` },
        ...(part.caption !== undefined && { caption: part.caption, parse_mode: 'HTML' as const }),
      });
    }
    return this.client.sendMessage({
      chat_id: chatId,
      text: part.html,
      parse_mode: 'HTML',
      ...(part.noPreview && { link_preview_options: { is_disabled: true } }),
    });
  }

  /** The username can change after connect; ask Telegram, fall back to what connect stored. */
  private async currentUsername(chatId: string, meta?: Record<string, unknown>): Promise<string | undefined> {
    const chat = await this.client.getChat(chatId);
    if (chat.ok) return chat.result.username || undefined;
    const stored = meta?.username;
    return typeof stored === 'string' && stored ? stored : undefined;
  }

  private publishFailure(f: TelegramFailure, index: number, total: number, delivered: number): PublishResult {
    const where = total > 1 ? ` (part ${index + 1} of ${total}${delivered ? `; ${delivered} already posted` : ''})` : '';
    const error = `${f.description}${where}`;
    switch (f.kind) {
      case 'rate_limited':
        return { success: false, error, retryable: true, retryAfterSec: f.retryAfterSec, failureCode: 'RATE_LIMITED' };
      case 'unreachable':
        return { success: false, error, retryable: true, failureCode: 'UNREACHABLE' };
      case 'revoked':
        return { success: false, error, retryable: false, failureCode: 'CONNECTION_REVOKED' };
      case 'not_configured':
        return { success: false, error, retryable: false, failureCode: 'NO_PUBLISHER' };
      case 'ambiguous':
      case 'server':
        // The message may have gone out. A blind retry could post it twice.
        return {
          success: false,
          error: `${error}. Telegram did not confirm the message; check the channel before retrying.`,
          retryable: false,
          failureCode: 'UNREACHABLE',
        };
      default:
        return { success: false, error, retryable: false, failureCode: 'PLATFORM_ERROR' };
    }
  }

  normalizeError(raw: unknown): string {
    return raw instanceof Error ? raw.message : String(raw);
  }
}
