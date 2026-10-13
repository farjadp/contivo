// spec -> images + music -> HyperFrames project -> MP4

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeProject } from './compose.js';
import { generateImage } from './images.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF_BIN = path.join(ROOT, 'node_modules', '.bin', 'hyperframes');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${out.slice(-1500)}`)),
    );
  });
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
    const rel = `assets/img/scene-${i}.png`;
    onProgress(`🎨 تصویر ${n + 1} از ${wanted.length}…`);
    try {
      await generateImage(prompt, path.join(work, rel));
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
  const { size } = await stat(out);
  if (size < 10_000) throw new Error(`rendered file is suspiciously small (${size} bytes)`);

  return { file: out, seconds: total, renderMs, images: Object.keys(imageFiles).length, size, warnings };
}

export async function copyOut(file, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(file, dest);
  return dest;
}
