#!/usr/bin/env node
/**
 * Render the motion-graphics showreel to MP4.
 *
 *   pnpm --filter @contivo/web showreel
 *
 * Walks scripts/showreel/scene.html frame by frame — the scene exposes
 * render(t), so nothing depends on wall-clock timing and the output is
 * identical on every machine — then encodes with ffmpeg and writes the poster
 * with sharp (Homebrew's ffmpeg has no WebP encoder).
 *
 * Frames are captured at 2× and scaled down, which is what keeps the type
 * crisp at 1280×800. Needs ffmpeg on PATH; takes about two minutes.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../public/marketing');
const SCENE = path.resolve(HERE, 'showreel/scene.html');
const FPS = 25;
const W = 1280;
const H = 800;

const frames = mkdtempSync(path.join(tmpdir(), 'contivo-showreel-'));
const browser = await puppeteer.launch({
  headless: true,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  await page.goto(`file://${SCENE}`, { waitUntil: 'networkidle0' });
  // Google Fonts must be in before the first frame, or frame 0 renders in a
  // fallback face and the reel opens with a visible font swap.
  await page.evaluate(() => document.fonts.ready);
  // Paint one frame and throw it away: the first paint after the font swap
  // lands a beat late, and capturing it puts an empty field in frame 0.
  await page.evaluate(() => window.render(0));
  await new Promise((r) => setTimeout(r, 600));

  const duration = await page.evaluate(() => window.DUR);
  const total = Math.round(duration * FPS);
  process.stdout.write(`Rendering ${total} frames (${duration}s at ${FPS}fps)…\n`);

  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`), type: 'png' });
    if (i % 25 === 0) process.stdout.write(`  ${i}/${total}\r`);
  }
  process.stdout.write(`  ${total}/${total}\n`);

  const mp4 = path.join(OUT, 'contivo-showreel.mp4');
  execFileSync('ffmpeg', [
    '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png'),
    '-vf', `scale=${W}:${H}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  // Poster: a frame from the middle of the Watch scene, where the chart reads
  // as the product rather than as an empty page.
  const poster = path.join(OUT, 'showreel-poster.webp');
  await sharp(path.join(frames, `f${String(Math.round(10.4 * FPS)).padStart(4, '0')}.png`))
    .resize(W, H).webp({ quality: 88 }).toFile(poster);

  const provenance = {
    prompt: 'Motion-graphics showreel of Contivo, drawn in the product\'s own design system ' +
      '(Chalk & Saffron) and rendered from scripts/showreel/scene.html by scripts/render-showreel.mjs. ' +
      'An illustrated explainer of the six-stage loop, not a screen recording — the product captures ' +
      'elsewhere on the page are the real screenshots. No audio track.',
    createdAt: new Date().toISOString(),
  };
  writeFileSync(`${mp4}.json`, JSON.stringify(provenance, null, 2) + '\n');
  writeFileSync(`${poster}.json`, JSON.stringify(
    { ...provenance, prompt: `${provenance.prompt} Poster frame.` }, null, 2) + '\n');

  process.stdout.write(`\nDone:\n  ${mp4}\n  ${poster}\n`);
} finally {
  await browser.close();
  rmSync(frames, { recursive: true, force: true });
}
