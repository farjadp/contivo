// Render worker entry point.
//
//  - Telegram bot (long polling: no public URL needed) for commands + approval
//  - BullMQ worker on queue `contivo-render` (Contivo can enqueue later);
//    falls back to an in-process queue when REDIS_URL is not set
//
// Phase 1 (MVP): nothing is ever published. Approve/reject is recorded only.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSpec } from './pipeline.js';
import { Telegram, approvalKeyboard } from './telegram.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS_DIR = path.join(ROOT, 'specs');
const QUEUE = 'contivo-render';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// No token yet: idle instead of crash-looping. Setting the variable in
// Railway redeploys the service, which picks it up.
if (!process.env.TELEGRAM_BOT_TOKEN) {
  log('TELEGRAM_BOT_TOKEN is not set — waiting. Set it in Railway → render-worker → Variables.');
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

const tg = new Telegram(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED = (process.env.TELEGRAM_ALLOWED_CHAT_ID || '').trim();

// ---------------------------------------------------------------- specs
async function listSpecs() {
  const files = await readdir(SPECS_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

async function loadSpec(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('invalid spec id');
  return JSON.parse(await readFile(path.join(SPECS_DIR, `${id}.json`), 'utf8'));
}

// ---------------------------------------------------------------- job runner
async function processJob(jobId, data) {
  const chatId = data.chatId || ALLOWED;
  const spec = data.spec || (await loadSpec(data.specId));
  const say = (t) => tg.sendMessage(chatId, t).catch((e) => log('say failed', e.message));
  log(`job ${jobId}: start ${spec.id}`);
  await say(`⏳ شروع ساخت «${spec.title || spec.id}»`);
  try {
    const r = await renderSpec(spec, { onProgress: say });
    const caption = [
      `🎬 ${spec.title || spec.id}`,
      `⏱ ${r.seconds} ثانیه · رندر در ${Math.round(r.renderMs / 1000)} ثانیه · ${r.images} تصویر`,
      spec.sources?.length ? `📚 منابع:\n${spec.sources.map((s) => `• ${s}`).join('\n')}` : '',
      spec.caption ? `\n✍️ کپشن پیشنهادی:\n${spec.caption}` : '',
      '\nمنتشر نشده — فقط برای بررسی.',
    ]
      .filter(Boolean)
      .join('\n');
    await tg.sendVideo(chatId, r.file, { caption, replyMarkup: approvalKeyboard(jobId) });
    log(`job ${jobId}: done ${r.seconds}s video in ${r.renderMs}ms`);
  } catch (err) {
    log(`job ${jobId}: failed`, err);
    await say(`❌ ساخت ناموفق بود:\n${String(err.message).slice(0, 800)}`);
    throw err;
  }
}

// ---------------------------------------------------------------- queue
let enqueue;
async function startQueue() {
  if (process.env.REDIS_URL) {
    const { Queue, Worker } = await import('bullmq');
    const connection = { url: process.env.REDIS_URL, maxRetriesPerRequest: null };
    const q = new Queue(QUEUE, { connection });
    new Worker(QUEUE, (job) => processJob(job.id, job.data), { connection, concurrency: 1 }).on('failed', (job, e) =>
      log(`bullmq job ${job?.id} failed: ${e.message}`),
    );
    enqueue = async (data) => (await q.add('render', data, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 })).id;
    log(`queue: BullMQ "${QUEUE}"`);
  } else {
    let chain = Promise.resolve();
    let n = 0;
    enqueue = async (data) => {
      const id = `local-${++n}`;
      chain = chain.then(() => processJob(id, data)).catch(() => {});
      return id;
    };
    log('queue: in-process (REDIS_URL not set)');
  }
}

// ---------------------------------------------------------------- bot
const pendingEdit = new Map(); // chatId -> jobId

async function handleMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  // Default deny: until TELEGRAM_ALLOWED_CHAT_ID is set, only reveal the chat id.
  if (!ALLOWED) {
    await tg.sendMessage(
      chatId,
      `شناسه‌ی چت شما: ${chatId}\nاین عدد را در Railway به اسم TELEGRAM_ALLOWED_CHAT_ID وارد کنید. تا آن موقع بات کاری انجام نمی‌دهد.`,
    );
    return;
  }
  if (chatId !== ALLOWED) {
    log(`ignored message from chat ${chatId}`);
    return;
  }

  if (pendingEdit.has(chatId) && !text.startsWith('/')) {
    const jobId = pendingEdit.get(chatId);
    pendingEdit.delete(chatId);
    log(`feedback job=${jobId}: ${text}`);
    await tg.sendMessage(chatId, `📝 ثبت شد برای ${jobId}.\nبازنویسی خودکار با هوش مصنوعی در فاز ۳ اضافه می‌شود.`);
    return;
  }

  const [cmd, arg] = text.split(/\s+/, 2);
  if (cmd === '/start' || cmd === '/help') {
    const specs = await listSpecs();
    await tg.sendMessage(
      chatId,
      `سلام! من render worker کانتیوو هستم.\n\n/render <نام> — ساخت ویدیو\n/specs — فهرست اسکریپت‌ها\n\nاسکریپت‌های موجود:\n${specs.map((s) => `• ${s}`).join('\n')}\n\nهیچ ویدیویی منتشر نمی‌شود؛ فقط برای بررسی شما فرستاده می‌شود.`,
    );
  } else if (cmd === '/specs') {
    await tg.sendMessage(chatId, (await listSpecs()).join('\n'));
  } else if (cmd === '/render') {
    const specs = await listSpecs();
    if (!arg || !specs.includes(arg)) {
      await tg.sendMessage(chatId, `نام اسکریپت را بنویسید، مثلاً:\n/render ${specs[0] || 'eresidency-fa'}`);
      return;
    }
    const id = await enqueue({ specId: arg, chatId });
    await tg.sendMessage(chatId, `📥 در صف قرار گرفت (${id}). حدود ۲ تا ۴ دقیقه طول می‌کشد.`);
  }
}

async function handleCallback(cb) {
  const chatId = String(cb.message?.chat?.id);
  if (!ALLOWED || chatId !== ALLOWED) return;
  const [action, jobId] = String(cb.data).split(':');
  if (action === 'ap') {
    log(`APPROVED job=${jobId}`);
    await tg.answerCallback(cb.id, 'تأیید شد');
    await tg.clearButtons(chatId, cb.message.message_id);
    await tg.sendMessage(chatId, `✅ تأیید شد (${jobId}). در فاز فعلی منتشر نمی‌شود.`);
  } else if (action === 'rj') {
    log(`REJECTED job=${jobId}`);
    await tg.answerCallback(cb.id, 'رد شد');
    await tg.clearButtons(chatId, cb.message.message_id);
  } else if (action === 'ed') {
    pendingEdit.set(chatId, jobId);
    await tg.answerCallback(cb.id, 'تغییر را بنویسید');
    await tg.sendMessage(chatId, '✏️ چه تغییری لازم است؟ در یک پیام بنویسید.');
  }
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message).catch((e) => log('message error', e.message));
        if (u.callback_query) await handleCallback(u.callback_query).catch((e) => log('callback error', e.message));
      }
    } catch (e) {
      log('poll error', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

await startQueue();
log(`render worker up · allowed chat: ${ALLOWED ? 'set' : 'NOT SET (setup mode)'}`);
poll();
