// Minimal Telegram Bot API client (fetch only, no SDK).

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.telegram.org';

export class Telegram {
  constructor(token) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.base = `${API}/bot${token}`;
  }

  async call(method, body) {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`telegram ${method}: ${data.description || res.status}`);
    return data.result;
  }

  getUpdates(offset) {
    return this.call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  }

  answerCallback(id, text) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text });
  }

  clearButtons(chatId, messageId) {
    return this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  /** Upload a local MP4 (bot API limit: 50 MB). */
  async sendVideo(chatId, file, { caption, replyMarkup } = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('supports_streaming', 'true');
    if (caption) form.append('caption', caption.slice(0, 1024));
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    const buf = await readFile(file);
    form.append('video', new Blob([buf], { type: 'video/mp4' }), path.basename(file));
    const res = await fetch(`${this.base}/sendVideo`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`telegram sendVideo: ${data.description || res.status}`);
    return data.result;
  }
}

export function approvalKeyboard(jobId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ تأیید', callback_data: `ap:${jobId}` },
        { text: '✏️ ویرایش', callback_data: `ed:${jobId}` },
        { text: '❌ رد', callback_data: `rj:${jobId}` },
      ],
    ],
  };
}
