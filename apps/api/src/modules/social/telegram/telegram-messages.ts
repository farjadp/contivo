/**
 * telegram-messages.ts
 *
 * What the Contivo bot says in its private chat, in English and Persian
 * (chosen from the Telegram user's language_code). Sent as plain text, no
 * parse_mode: workspace and chat names are user-controlled and must not be
 * read as markup; telegramDisplayName() also flattens and caps them.
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
  | 'buttonNotMe'
  | 'code'
  | 'denied'
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
  buttonNotMe: 'This wasn\'t me',
  code:
    'The Contivo workspace “{workspace}” wants to post to “{title}”. To finish, enter this code in that Contivo account:\n\n{code}\n\n' +
    'If you did not start this, tap “This wasn\'t me” below. Never send this code to anyone.',
  denied: 'Stopped. Nothing was connected, and the code no longer works.',
  connected: 'Connected. Contivo will post to “{title}”.',
  bot_not_admin: 'The Contivo bot cannot post in “{title}”. Make it an admin with the Post messages right, then choose the chat again.',
  user_not_admin: 'You need to be an admin who can post in “{title}” to connect it.',
  not_a_channel_or_group: 'Choose a channel or a group.',
  telegram_unavailable: 'Telegram did not answer. Try again in a minute.',
  chat_not_found: 'Telegram could not find that channel or group.',
  too_many_attempts: 'The code was entered wrong too many times. Start again from Contivo.',
};

const FA: Record<Key, string> = {
  help: 'این ربات پست‌های Contivo را در کانال تلگرام شما منتشر می‌کند. برای وصل کردن کانال، در Contivo به صفحهٔ «اتصال‌ها» بروید، «اتصال حساب» را بزنید و تلگرام را انتخاب کنید.',
  expired: 'مهلت این لینک تمام شده یا قبلاً از آن استفاده شده است. در Contivo به صفحهٔ «اتصال‌ها» بروید و اتصال تلگرام را از اول شروع کنید.',
  choose:
    'کانال یا گروهی را انتخاب کنید که Contivo برای فضای کاری «{workspace}» در آن پست بگذارد. ربات فقط با اجازهٔ ارسال پیام مدیر آن می‌شود و دسترسی دیگری نمی‌گیرد.\n\n' +
    'اگر خودتان این کار را در حساب Contivo شروع نکرده‌اید، این پیام را نادیده بگیرید.',
  buttonChannel: 'انتخاب کانال',
  buttonGroup: 'انتخاب گروه',
  buttonNotMe: 'من نبودم',
  code:
    'فضای کاری «{workspace}» در Contivo می‌خواهد در «{title}» پست بگذارد. برای تمام کردن اتصال، این کد را در همان حساب Contivo وارد کنید:\n\n{code}\n\n' +
    'اگر این درخواست را شما نداده‌اید، دکمهٔ «من نبودم» را بزنید. این کد را برای هیچ‌کس نفرستید.',
  denied: 'اتصال لغو شد. چیزی وصل نشد و این کد دیگر کار نمی‌کند.',
  connected: 'وصل شد. از این به بعد Contivo در «{title}» پست می‌گذارد.',
  bot_not_admin: 'ربات Contivo نمی‌تواند در «{title}» پست بگذارد. آن را با اجازهٔ «ارسال پیام» مدیر کنید و بعد دوباره کانال را انتخاب کنید.',
  user_not_admin: 'برای وصل کردن «{title}»، خودتان باید در آن مدیری باشید که اجازهٔ ارسال پیام دارد.',
  not_a_channel_or_group: 'لطفاً یک کانال یا گروه انتخاب کنید.',
  telegram_unavailable: 'تلگرام جواب نداد. یک دقیقهٔ دیگر دوباره امتحان کنید.',
  chat_not_found: 'تلگرام این کانال یا گروه را پیدا نکرد.',
  too_many_attempts: 'کد چند بار اشتباه وارد شد. در Contivo اتصال را از اول شروع کنید.',
};

const FALLBACK_TITLE: Record<TelegramLang, string> = { en: 'this chat', fa: 'این کانال' };
const FALLBACK_WORKSPACE: Record<TelegramLang, string> = { en: 'Contivo', fa: 'Contivo' };

/** Longest name the bot puts in a message, in characters (code points), ellipsis included. */
export const TELEGRAM_NAME_MAX = 60;

// Control characters (newlines, tabs, …), line/paragraph separators, and the
// bidi controls that reorder text (LRM/RLM/ALM, embeddings/overrides, isolates).
// ZWNJ (U+200C) stays: Persian names need it.
const CONTROLS = /[\p{Cc}\u2028\u2029\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/gu;
// The marks our templates quote with, and their relatives. A name cannot close the quote.
const QUOTES = /["“”„‟«»‹›‚‛`]/g;

/**
 * A workspace or chat name as the bot may show it. Both are user-controlled
 * (the workspace name by whoever made the session, possibly an attacker): no
 * line breaks to fake a second paragraph, no bidi tricks, no quote marks to
 * break out of “…”, at most TELEGRAM_NAME_MAX characters.
 */
export function telegramDisplayName(input: string | null | undefined): string {
  const flat = String(input ?? '')
    .replace(CONTROLS, ' ')
    .replace(QUOTES, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  if (chars.length <= TELEGRAM_NAME_MAX) return flat;
  return `${chars.slice(0, TELEGRAM_NAME_MAX - 1).join('').trimEnd()}…`;
}

const toPersianDigits = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export function telegramText(lang: TelegramLang | undefined, key: Key, params: Record<string, string> = {}): string {
  const l: TelegramLang = lang === 'fa' ? 'fa' : 'en';
  const table = l === 'fa' ? FA : EN;
  const values: Record<string, string> = {
    ...params,
    title: telegramDisplayName(params.title) || FALLBACK_TITLE[l],
    workspace: telegramDisplayName(params.workspace) || FALLBACK_WORKSPACE[l],
    ...(params.code && { code: l === 'fa' ? toPersianDigits(params.code) : params.code }),
  };
  return table[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}
