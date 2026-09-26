#!/usr/bin/env node
/**
 * Re-shoot the marketing site's product captures and reel from the running app.
 *
 *   pnpm --filter @contivo/web capture:marketing <workspaceId> [baseUrl]
 *
 * Opens a visible Chrome window at the sign-in page and waits for YOU to sign
 * in. For an unattended run against a LOCAL app, set CAPTURE_EMAIL and
 * CAPTURE_PASSWORD (apps/web/.env.local) for a local test account: the script
 * then runs headless, signs up if the account does not exist yet, and signs in
 * through the app's own form. Once signed in it walks the workspace and
 * writes, into public/marketing/:
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
 *
 * CAPTURE_REVIEW_DIR=<dir> additionally saves a full-page shot of every stage
 * tab and Today, in en and fa, for reviewing the app with real data.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const [workspaceId, baseArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!workspaceId) {
  console.error('Usage: capture-marketing.mjs <workspaceId> [baseUrl]');
  process.exit(1);
}
const BASE = (baseArg || process.env.CAPTURE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/marketing');
const SCALE = 2;
const EMAIL = process.env.CAPTURE_EMAIL;
const PASSWORD = process.env.CAPTURE_PASSWORD;
const AUTO = Boolean(EMAIL && PASSWORD);
if (AUTO && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error('CAPTURE_EMAIL/PASSWORD are for a local test account only; refusing to send them to', BASE);
  process.exit(1);
}
const REVIEW_DIR = process.env.CAPTURE_REVIEW_DIR;

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
  headless: AUTO,
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: SCALE },
  args: ['--window-size=1440,1000'],
});

try {
  const page = await browser.newPage();
  // Poll the URL rather than evaluating in the page: the post-sign-in redirect
  // destroys any in-page wait mid-flight.
  const signedIn = async () => {
    const deadline = Date.now() + (AUTO ? 20_000 : 5 * 60_000);
    while (Date.now() < deadline) {
      if (/\/(dashboard|growth|admin|onboarding)/.test(new URL(page.url()).pathname)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Not signed in before the deadline');
  };
  if (AUTO) {
    const submit = async (route, fields) => {
      await page.goto(`${BASE}/en/${route}`, { waitUntil: 'networkidle2' });
      for (const [selector, value] of fields) await page.type(selector, value);
      await page.click('button[type="submit"]');
    };
    await submit('sign-in', [['input[type="email"]', EMAIL], ['input[type="password"]', PASSWORD]]);
    try {
      await signedIn();
    } catch {
      console.log('→ No such local account yet; signing up.');
      await submit('sign-up', [['input[type="text"]', 'Capture'], ['input[type="email"]', EMAIL], ['input[type="password"]', PASSWORD]]);
      await signedIn();
    }
  } else {
    await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle2' });
    console.log('\n→ Sign in in the Chrome window. Waiting up to 5 minutes…\n');
    await signedIn();
  }
  if (process.argv.includes('--account-only')) {
    console.log('✓ Account ready.');
    await browser.close();
    process.exit(0);
  }
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
  // Many ffmpeg builds (Homebrew's included) ship without a WebP encoder, so
  // the poster goes through sharp, which Next.js already depends on.
  const { default: sharp } = await import('sharp');
  await sharp(path.join(frames, 'f0.png')).resize(1280, 800).webp({ quality: 86 }).toFile(path.join(OUT, 'reel-poster.webp'));
  writeFileSync(path.join(OUT, 'reel-poster.webp.json'), JSON.stringify(provenance('first frame of contivo-reel.mp4'), null, 2) + '\n');
  rmSync(frames, { recursive: true, force: true });
  console.log('  ✓ contivo-reel.mp4, reel-poster.webp');

  if (REVIEW_DIR) {
    const tabs = ['strategy', 'offerings', 'matrices', 'keywords', 'seo', 'narrative', 'ideation', 'pipeline', 'calendar', 'autopilot', 'reports'];
    for (const locale of ['en', 'fa']) {
      await page.goto(`${BASE}/${locale}/dashboard`, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 1000));
      await page.screenshot({ path: path.join(REVIEW_DIR, `${locale}-today.png`), fullPage: true });
      for (const tab of tabs) {
        await page.goto(`${BASE}/${locale}/growth/${workspaceId}?tab=${tab}`, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 1200));
        await page.screenshot({ path: path.join(REVIEW_DIR, `${locale}-${tab}.png`), fullPage: true });
      }
    }
    console.log(`  ✓ review shots in ${REVIEW_DIR}`);
  }
  console.log('\nDone. Review the files, then commit public/marketing/.');
} finally {
  await browser.close();
}
