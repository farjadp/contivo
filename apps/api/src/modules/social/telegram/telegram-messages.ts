/**
 * telegram-messages.ts
 *
 * What the Contivo bot says in its private chat, in English and Persian
 * (chosen from the Telegram user's language_code). Sent as plain text, no
 * parse_mode: workspace and chat names are user-controlled and must not be
 * read as markup.
 *
 * Persian is written, not translated (formal-but-human, شما). Digits in the
 * Persian code message are Persian; the API accepts either when it is typed.
 */

export type TelegramLang = 'en' | 'fa';

type Key =
  | 'help'
  | 'expired'
  | 'choose'
  | 'buttonChannel'
  | 'buttonGroup'
  | 'code'
  | 'connected'
  | 'bot_not_admin'
  | 'user_not_admin'
  | 'not_a_channel_or_group'
  | 'telegram_unavailable'
  | 'chat_not_found'
  | 'too_many_attempts';

const EN: Record<Key, string> = {
  help: 'This bot posts to Telegram for Contivo. To connect a channel, open Contivo, go to Connections and choose Connect Telegram.',
  expired: 'This connect link has expired or was already used. In Contivo, go to Connections and choose Connect Telegram again.',
  choose:
    'Pick the channel or group where Contivo should post for the workspace “{workspace}”. The bot joins as an admin that can only post messages.\n\n' +
    'If you did not start this in your own Contivo account, ignore this message.',
  buttonChannel: 'Choose a channel',
  buttonGroup: 'Choose a group',
  code:
    '“{title}” is ready. To finish, enter this code in Contivo:\n\n{code}\n\n' +
    'Enter it only in your own Contivo account. Contivo will never ask you to send it to anyone.',
  connected: 'Connected. Contivo will post to “{title}”.',
  bot_not_admin: 'The Contivo bot cannot post in “{title}”. Make it an admin with the Post messages right, then choose the chat again.',
  user_not_admin: 'You need to be an admin who can post in “{title}” to connect it.',
  not_a_channel_or_group: 'Choose a channel or a group.',
  telegram_unavailable: 'Telegram did not answer. Try again in a minute.',
  chat_not_found: 'Telegram could not find that channel or group.',
  too_many_attempts: 'The code was entered wrong too many times. Start again from Contivo.',
};

const FA: Record<Key, string> = {
  help: 'این ربات پست‌های Contivo را در تلگرام منتشر می‌کند. برای اتصال کانال، در Contivo به بخش «اتصال‌ها» بروید و «اتصال تلگرام» را بزنید.',
  expired: 'این لینک اتصال منقضی شده یا قبلاً استفاده شده است. در Contivo به بخش «اتصال‌ها» بروید و دوباره «اتصال تلگرام» را بزنید.',
  choose:
    'کانال یا گروهی را انتخاب کنید که Contivo برای فضای کاری «{workspace}» در آن پست بگذارد. ربات فقط با اجازه‌ی ارسال پیام، مدیر آن می‌شود.\n\n' +
    'اگر این کار را خودتان در حساب Contivo شروع نکرده‌اید، این پیام را نادیده بگیرید.',
  buttonChannel: 'انتخاب کانال',
  buttonGroup: 'انتخاب گروه',
  code:
    '«{title}» آماده است. برای تمام کردن کار، این کد را در Contivo وارد کنید:\n\n{code}\n\n' +
    'کد را فقط در حساب Contivo خودتان وارد کنید. Contivo هیچ‌وقت از شما نمی‌خواهد این کد را برای کسی بفرستید.',
  connected: 'اتصال برقرار شد. از این به بعد Contivo در «{title}» پست می‌گذارد.',
  bot_not_admin: 'ربات Contivo نمی‌تواند در «{title}» پست بگذارد. آن را با اجازه‌ی «ارسال پیام» مدیر کنید و دوباره کانال را انتخاب کنید.',
  user_not_admin: 'برای اتصال «{title}»، خودتان باید مدیری با اجازه‌ی ارسال پیام در آن باشید.',
  not_a_channel_or_group: 'یک کانال یا گروه انتخاب کنید.',
  telegram_unavailable: 'تلگرام پاسخ نداد. یک دقیقه‌ی دیگر دوباره امتحان کنید.',
  chat_not_found: 'تلگرام این کانال یا گروه را پیدا نکرد.',
  too_many_attempts: 'کد چند بار اشتباه وارد شد. از Contivo دوباره شروع کنید.',
};

const FALLBACK_TITLE: Record<TelegramLang, string> = { en: 'this chat', fa: 'این کانال' };
const FALLBACK_WORKSPACE: Record<TelegramLang, string> = { en: 'Contivo', fa: 'Contivo' };

const toPersianDigits = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export function telegramText(lang: TelegramLang | undefined, key: Key, params: Record<string, string> = {}): string {
  const l: TelegramLang = lang === 'fa' ? 'fa' : 'en';
  const table = l === 'fa' ? FA : EN;
  const values: Record<string, string> = {
    ...params,
    title: params.title?.trim() || FALLBACK_TITLE[l],
    workspace: params.workspace?.trim() || FALLBACK_WORKSPACE[l],
    ...(params.code && { code: l === 'fa' ? toPersianDigits(params.code) : params.code }),
  };
  return table[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}
