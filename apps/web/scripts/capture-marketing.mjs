#!/usr/bin/env node
/**
 * Re-shoot the marketing site's product captures and reel from the running app.
 *
 *   pnpm --filter @contivo/web capture:marketing <workspaceId> [baseUrl]
 *
 * Opens a visible Chrome window at the sign-in page and waits for YOU to sign
 * in — the script never sees or stores a password or session token. Once the
 * app lands on a signed-in page it walks the workspace and writes, into
 * public/marketing/:
 *
 *   brand-memory.webp    1800×1212  Know  · Brand memory tab
 *   market-map.webp      1800×1074  Watch · Market matrices tab
 *   setup-chain.webp     1800×400   the setup guide (data-capture="setup-chain")
 *   generated-post.webp  1400×1114  Make  · Pipeline tab
 *   contivo-reel.mp4     12 s, 1280×800, H.264, no audio (needs ffmpeg)
 *   reel-poster.webp     first frame of the reel
 *
 * The pixel sizes are the ones the homepage already declares, so the page code
 * does not change when the pictures do. Each image gets a .webp.json sidecar
 * saying where it came from, as DESIGN.md requires.
 *
 * Use a workspace with real data (competitors accepted, charts generated,
 * content in the pipeline); an empty workspace produces honest but empty shots.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const [workspaceId, baseArg] = process.argv.slice(2);
if (!workspaceId) {
  console.error('Usage: capture-marketing.mjs <workspaceId> [baseUrl]');
  process.exit(1);
}
const BASE = (baseArg || process.env.CAPTURE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/marketing');
const SCALE = 2;

// CSS-pixel clip sizes; at DPR 2 they produce the file sizes listed above.
const SHOTS = [
  { file: 'brand-memory', tab: 'strategy', selector: '[data-capture="tab"]', w: 900, h: 606, what: 'Brand Memory tab — business summary, value proposition, audience and tone' },
  { file: 'market-map', tab: 'matrices', selector: '[data-capture="tab"]', w: 900, h: 537, what: 'Market matrices tab — the brand plotted among accepted competitors' },
  { file: 'setup-chain', tab: 'matrices', selector: '[data-capture="setup-chain"]', w: 900, h: 200, what: 'The setup guide — done steps, the next step and the locked ones' },
  { file: 'generated-post', tab: 'pipeline', selector: '[data-capture="tab"]', w: 700, h: 557, what: 'Pipeline tab — a post Contivo wrote' },
];

const provenance = (what) => ({
  prompt: `Captured from the running Contivo app via Puppeteer at 1440x900, deviceScaleFactor ${SCALE}, workspace ${workspaceId}, on the Chalk & Saffron design. Not generated, not a mockup. Crop: ${what}.`,
  createdAt: new Date().toISOString(),
});

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: SCALE },
  args: ['--window-size=1440,1000'],
});

try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle2' });
  console.log('\n→ Sign in in the Chrome window. Waiting up to 5 minutes…\n');
  await page.waitForFunction(() => /\/(dashboard|growth|admin)/.test(location.pathname), {
    timeout: 5 * 60_000,
    polling: 1000,
  });
  console.log('✓ Signed in. Capturing…');

  // Stills for the reel, in the order the loop walks.
  const frames = mkdtempSync(path.join(tmpdir(), 'contivo-reel-'));
  const reelTabs = ['strategy', 'matrices', 'ideation', 'pipeline'];

  for (const shot of SHOTS) {
    await page.goto(`${BASE}/en/growth/${workspaceId}?tab=${shot.tab}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(shot.selector, { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1200)); // let charts and images settle
    const box = await page.$eval(shot.selector, (el) => {
      el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width };
    });
    const file = path.join(OUT, `${shot.file}.webp`);
    await page.screenshot({
      path: file,
      type: 'webp',
      quality: 86,
      captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: Math.min(shot.w, box.width), height: shot.h },
    });
    writeFileSync(`${file}.json`, JSON.stringify(provenance(shot.what), null, 2) + '\n');
    console.log(`  ✓ ${shot.file}.webp`);
  }

  for (const [i, tab] of reelTabs.entries()) {
    await page.goto(`${BASE}/en/growth/${workspaceId}?tab=${tab}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(frames, `f${i}.png`), type: 'png' });
  }

  // 4 stills × 3 s with 0.5 s crossfades, 1280×800, no audio track.
  const inputs = reelTabs.flatMap((_, i) => ['-loop', '1', '-t', '3.5', '-i', path.join(frames, `f${i}.png`)]);
  const fades = [
    '[0][1]xfade=transition=fade:duration=0.5:offset=3[a]',
    '[a][2]xfade=transition=fade:duration=0.5:offset=6[b]',
    '[b][3]xfade=transition=fade:duration=0.5:offset=9,scale=1280:800,format=yuv420p[v]',
  ].join(';');
  execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', fades, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', path.join(OUT, 'contivo-reel.mp4')], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-i', path.join(frames, 'f0.png'), '-vf', 'scale=1280:800', '-quality', '86', path.join(OUT, 'reel-poster.webp')], { stdio: 'inherit' });
  writeFileSync(path.join(OUT, 'reel-poster.webp.json'), JSON.stringify(provenance('first frame of contivo-reel.mp4'), null, 2) + '\n');
  rmSync(frames, { recursive: true, force: true });
  console.log('  ✓ contivo-reel.mp4, reel-poster.webp\n\nDone. Review the files, then commit public/marketing/.');
} finally {
  await browser.close();
}
