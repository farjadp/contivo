// spec -> images + music -> HyperFrames project -> MP4

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeProject } from './compose.js';
import { generateImage } from './images.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF_BIN = path.join(ROOT, 'node_modules', '.bin', 'hyperframes');

// Drop FFmpeg/HyperFrames progress noise so the real error is visible.
export function meaningfulTail(out, max = 2500) {
  return out
    .split(/[\r\n]+/)
    .filter((l) => l.trim() && !/^\s*frame=|hf-progress|█|░|Render:trace.*checkpoint/.test(l))
    .join('\n')
    .slice(-max);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve(out);
      // Full output to the service log; a readable tail in the error.
      console.error(`--- ${path.basename(cmd)} output (exit ${code}, signal ${signal}) ---\n${meaningfulTail(out, 12000)}`);
      reject(new Error(`${path.basename(cmd)} exited ${code}${signal ? ` (${signal})` : ''}:\n${meaningfulTail(out)}`));
    });
  });
}

// Generated images cached by prompt+model for the life of the container, so
// retrying a failed render does not pay for the same images again.
const IMG_CACHE = path.join(tmpdir(), 'render-image-cache');
async function cachedImage(prompt, dest) {
  const key = createHash('sha256').update(`${process.env.IMAGE_MODEL || ''}|${prompt}`).digest('hex').slice(0, 24);
  const cached = path.join(IMG_CACHE, `${key}.jpg`);
  try {
    await stat(cached);
  } catch {
    await mkdir(IMG_CACHE, { recursive: true });
    const raw = path.join(IMG_CACHE, `${key}.png`);
    await generateImage(prompt, raw);
    // JPEG at frame width: ~10x smaller than the PNG, less for Chrome to decode.
    await run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', 'scale=1080:-2', '-q:v', '3', cached]);
  }
  await copyFile(cached, dest);
  return { cached: true };
}

// Telegram bots cannot send files over 50 MB.
const TELEGRAM_MAX = 45 * 1024 * 1024;
export async function fitForTelegram(file) {
  const { size } = await stat(file);
  if (size <= TELEGRAM_MAX) return file;
  const smaller = file.replace(/\.mp4$/, '.tg.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-maxrate', '10M', '-bufsize', '20M', '-c:a', 'copy', '-movflags', '+faststart', smaller]);
  return smaller;
}

export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('spec must be an object');
  if (!spec.id || !/^[a-z0-9-]+$/.test(spec.id)) throw new Error('spec.id must be kebab-case');
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) throw new Error('spec.scenes is empty');
  if (spec.scenes.length > 8) throw new Error('max 8 scenes');
  const total = spec.scenes.reduce((s, x) => s + (Number(x.duration) || 5), 0);
  if (total > 90) throw new Error('max 90 seconds (Instagram API caps Reels at 90 s)');
  return total;
}

/**
 * Renders a spec. `onProgress(text)` gets short status lines.
 * Returns { file, seconds, renderMs, images }.
 */
export async function renderSpec(spec, { onProgress = () => {}, skipImages = false } = {}) {
  const total = validateSpec(spec);
  const work = await mkdtemp(path.join(tmpdir(), `render-${spec.id}-`));
  const imgDir = path.join(work, 'assets', 'img');
  const audioDir = path.join(work, 'assets', 'audio');
  await mkdir(imgDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  // 1. images (sequential: keeps rate limits and cost predictable).
  // Best-effort, like Contivo's own images: a failure never blocks the video.
  // A quota/auth error stops further attempts (they would fail the same way).
  const imageFiles = {};
  const warnings = [];
  const wanted = spec.scenes.map((s, i) => [i, s.image]).filter(([, p]) => p);
  for (const [n, [i, prompt]] of wanted.entries()) {
    if (skipImages) break;
    const rel = `assets/img/scene-${i}.jpg`;
    onProgress(`🎨 تصویر ${n + 1} از ${wanted.length}…`);
    try {
      await cachedImage(prompt, path.join(work, rel));
      imageFiles[i] = rel;
    } catch (err) {
      const msg = String(err.message);
      const fatal = /insufficient_quota|credit_balance|401|invalid_api_key|not set/.test(msg);
      warnings.push(fatal ? `image provider unavailable: ${msg.slice(0, 160)}` : `scene ${i + 1} image failed`);
      onProgress(fatal ? '⚠️ ساخت تصویر ممکن نیست؛ ادامه بدون تصویر.' : `⚠️ تصویر ${n + 1} ساخته نشد؛ ادامه.`);
      if (fatal) break;
    }
  }

  // 2. music: original, generated, no copyright risk
  let hasMusic = false;
  if (spec.music !== 'none') {
    onProgress('🎵 ساخت موزیک…');
    await run('python3', [path.join(ROOT, 'music', 'music.py'), path.join(audioDir, 'bgm.wav'), String(total)]);
    hasMusic = true;
  }

  // 3. composition
  await writeProject(work, spec, { imageFiles, hasMusic });

  // 4. lint gate: a lint error (e.g. dir="rtl" on <html>) means a broken video
  const env = {
    ...process.env,
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
  };
  const lint = await run(HF_BIN, ['lint'], { cwd: work, env }).catch((e) => e.message);
  const m = /(\d+) error\(s\)/.exec(lint);
  if (m && Number(m[1]) > 0) throw new Error(`lint failed:\n${lint.slice(-1500)}`);

  // 5. render
  onProgress('🎬 رندر ویدیو…');
  const out = path.join(work, 'out', `${spec.id}.mp4`);
  const t0 = Date.now();
  await run(HF_BIN, ['render', '--output', out], { cwd: work, env });
  const renderMs = Date.now() - t0;
  const { size: rawSize } = await stat(out);
  if (rawSize < 10_000) throw new Error(`rendered file is suspiciously small (${rawSize} bytes)`);
  const file = await fitForTelegram(out);
  const { size } = await stat(file);

  return { file, seconds: total, renderMs, images: Object.keys(imageFiles).length, size, warnings };
}

export async function copyOut(file, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(file, dest);
  return dest;
}
