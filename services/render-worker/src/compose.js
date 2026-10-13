// Turns a video spec into a HyperFrames composition (index.html + assets).
//
// Hard rules learned in testing (see docs/video-pipeline/PLAN.md):
//  - NEVER put dir="rtl" on <html>: HyperFrames renders a fully black video
//    with no error. Direction goes on #root instead.
//  - GSAP and fonts are bundled locally, never loaded from a CDN.
//  - Only deterministic logic in the page (no Date.now / Math.random).

import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const FONT_FILES = ['Regular', 'Medium', 'Bold', 'Black'];

/** Escape text, then turn **word** into an accent span and \n into <br>. */
export function richText(input = '') {
  const escaped = String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    // [\s\S] so an accent may span a line break ("**a\nb**")
    .replace(/\*\*([\s\S]+?)\*\*/g, '<span class="acc">$1</span>')
    .replace(/\n/g, '<br />');
}

/** Assign start times to scenes; total = sum of durations. */
export function layoutScenes(scenes) {
  let t = 0;
  return scenes.map((s, i) => {
    const d = Number(s.duration) || 5;
    const out = { ...s, index: i, start: t, duration: d };
    t += d;
    return out;
  });
}

function sceneInner(s) {
  const kicker = s.kicker ? `<div class="kicker">${richText(s.kicker)}</div>` : '';
  switch (s.type) {
    case 'hook':
      return `${kicker}<div class="hook">${richText(s.title)}</div>`;
    case 'list':
      return `${kicker}<ul class="list">${(s.items || [])
        .map((it, j) => `<li id="s${s.index}i${j}">${richText(it)}</li>`)
        .join('')}</ul>`;
    case 'warn':
      return `<div class="warn">${kicker}<div class="body">${richText(s.title)}</div>${
        s.body ? `<div class="body muted">${richText(s.body)}</div>` : ''
      }</div>`;
    case 'cta':
      return `<div class="cta-box">${kicker}<div class="body cta">${richText(s.title)}</div></div>${
        s.handle ? `<div class="handle">${richText(s.handle)}</div>` : ''
      }`;
    default:
      return `${kicker}<div class="body">${richText(s.title)}</div>${
        s.body ? `<div class="body muted">${richText(s.body)}</div>` : ''
      }`;
  }
}

function sceneTimeline(s) {
  const a = s.start;
  const lines = [];
  if (s.type === 'list') {
    lines.push(`tl.from("#s${s.index} .kicker", { opacity: 0, y: 30, duration: 0.4 }, ${a + 0.3});`);
    (s.items || []).forEach((_, j) => {
      lines.push(
        `tl.from("#s${s.index}i${j}", { opacity: 0, x: -60, duration: 0.5, ease: "power2.out" }, ${(a + 0.8 + j * 0.8).toFixed(2)});`,
      );
    });
  } else {
    lines.push(
      `tl.from("#s${s.index} .inner", { opacity: 0, y: 60, duration: 0.8, ease: "power3.out" }, ${(a + 0.3).toFixed(2)});`,
    );
  }
  // fade out every scene except the last
  if (!s.last) {
    lines.push(
      `tl.to("#s${s.index}", { opacity: 0, y: -40, duration: 0.4, ease: "power2.in" }, ${(a + s.duration - 0.4).toFixed(2)});`,
    );
  }
  return lines.join('\n      ');
}

export function buildHtml(spec, { imageFiles = {}, hasMusic = false } = {}) {
  const scenes = layoutScenes(spec.scenes);
  scenes[scenes.length - 1].last = true;
  const total = scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
  const dir = spec.direction === 'ltr' ? 'ltr' : 'rtl';
  const font = dir === 'rtl' ? '"Vazirmatn", sans-serif' : '"Vazirmatn", Inter, sans-serif';

  // Background layers: one per scene that has an image; it covers its scene.
  const bgLayers = scenes
    .filter((s) => imageFiles[s.index])
    .map(
      (s) =>
        `<div id="bg${s.index}" class="bg clip" data-start="${s.start}" data-duration="${s.duration}" data-track-index="${1 + (s.index % 3)}"><img id="im${s.index}" src="${imageFiles[s.index]}" alt="" /></div>`,
    )
    .join('\n      ');

  const bgMotion = scenes
    .filter((s) => imageFiles[s.index])
    .map((s, k) => {
      const from = k % 2 === 0 ? '{ scale: 1.0 }' : '{ scale: 1.14 }';
      const to = k % 2 === 0 ? `{ scale: 1.12, duration: ${s.duration}, ease: "none" }` : `{ scale: 1.0, duration: ${s.duration}, ease: "none" }`;
      return `tl.fromTo("#im${s.index}", ${from}, ${to}, ${s.start});
      tl.from("#bg${s.index}", { opacity: 0, duration: 0.7, ease: "power1.inOut" }, ${s.start});`;
    })
    .join('\n      ');

  const sceneHtml = scenes
    .map(
      (s) =>
        `<section id="s${s.index}" class="clip scene ${s.type === 'warn' || s.type === 'cta' || !imageFiles[s.index] ? 'center' : ''}" data-start="${s.start}" data-duration="${s.duration}" data-track-index="0"><div class="inner">${sceneInner(s)}</div></section>`,
    )
    .join('\n      ');

  const audio = hasMusic
    ? `<audio id="bgm" src="assets/audio/bgm.wav" data-start="0" data-duration="${total}" data-track-index="9" data-volume="0.8"></audio>`
    : '';

  return `<!doctype html>
<html lang="${spec.language || 'fa'}" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="assets/js/gsap.min.js"></script>
    <style>
      ${FONT_FILES.map(
        (w, i) =>
          `@font-face { font-family: "Vazirmatn"; src: url("assets/fonts/Vazirmatn-${w}.ttf") format("truetype"); font-weight: ${[400, 500, 700, 900][i]}; }`,
      ).join('\n      ')}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0b1220; }
      #root { position: relative; width: 1080px; height: 1920px; overflow: hidden;
        font-family: ${font}; color: #f5f1e8; direction: ${dir}; background: #0b1220; }
      .bg { position: absolute; inset: 0; overflow: hidden; }
      .bg img { width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
      .bg::after { content: ""; position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(11,18,32,0.25) 0%, rgba(11,18,32,0.35) 40%, rgba(11,18,32,0.92) 78%, #0b1220 100%); }
      .clip { position: absolute; inset: 0; }
      .scene { display: flex; flex-direction: column; justify-content: flex-end; padding: 0 88px 360px; }
      .scene.center { justify-content: center; padding-bottom: 0; }
      .brand { position: absolute; top: 110px; right: 88px; left: 88px; z-index: 5;
        display: flex; align-items: center; justify-content: space-between;
        font-size: 34px; font-weight: 700; color: #e8a33d; text-shadow: 0 2px 12px rgba(0,0,0,0.5); }
      .brand .dot { width: 18px; height: 18px; border-radius: 50%; background: #e8a33d; }
      .kicker { font-size: 42px; font-weight: 500; color: #c9d6f0; margin-bottom: 28px; text-shadow: 0 2px 12px rgba(0,0,0,0.6); }
      .hook { font-size: 120px; font-weight: 900; line-height: 1.25; text-shadow: 0 4px 24px rgba(0,0,0,0.6); }
      .acc { color: #e8a33d; }
      .body { font-size: 70px; font-weight: 700; line-height: 1.45; text-shadow: 0 3px 18px rgba(0,0,0,0.6); }
      .body.cta { font-size: 62px; }
      .muted { color: #c9d3e6; font-weight: 500; font-size: 54px; margin-top: 36px; }
      .list { list-style: none; margin-top: 12px; }
      .list li { font-size: 64px; font-weight: 700; line-height: 1.5; display: flex; align-items: center; gap: 28px; }
      .list li::before { content: ""; width: 22px; height: 22px; border-radius: 6px; background: #e8a33d; flex: none; }
      .warn { border-inline-start: 14px solid #e8a33d; padding-block: 36px; padding-inline: 48px 0; }
      .cta-box { border: 4px solid #e8a33d; border-radius: 36px; padding: 60px; background: rgba(232,163,61,0.08); }
      .handle { margin-top: 64px; font-size: 48px; font-weight: 700; color: #9fb3d9; direction: ltr; text-align: ${dir === 'rtl' ? 'right' : 'left'}; }
      .source { position: absolute; bottom: 120px; right: 88px; left: 88px; z-index: 5;
        font-size: 27px; font-weight: 400; color: #8a97b3; line-height: 1.6; }
      .progress { position: absolute; bottom: 72px; right: 88px; left: 88px; height: 8px; z-index: 5;
        background: rgba(255,255,255,0.14); border-radius: 4px; overflow: hidden; }
      .progress i { display: block; height: 100%; width: 100%; background: #e8a33d;
        transform-origin: ${dir === 'rtl' ? 'right' : 'left'} center; transform: scaleX(0); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1080" data-height="1920">
      ${audio}
      ${bgLayers}
      <div class="brand"><span>${richText(spec.brand || '')}</span><span class="dot"></span></div>
      ${sceneHtml}
      ${spec.source ? `<div class="source">${richText(spec.source)}</div>` : ''}
      <div class="progress"><i id="bar"></i></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to("#bar", { scaleX: 1, duration: ${total}, ease: "none" }, 0);
      ${bgMotion}
      ${scenes.map(sceneTimeline).join('\n      ')}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

/** Write a full project directory HyperFrames can render. */
export async function writeProject(dir, spec, { imageFiles = {}, hasMusic = false } = {}) {
  await mkdir(path.join(dir, 'assets', 'fonts'), { recursive: true });
  await mkdir(path.join(dir, 'assets', 'js'), { recursive: true });
  const gsapPath = require.resolve('gsap/dist/gsap.min.js');
  await copyFile(gsapPath, path.join(dir, 'assets', 'js', 'gsap.min.js'));
  const fontDir = path.join(path.dirname(require.resolve('vazirmatn/package.json')), 'fonts', 'ttf');
  for (const w of FONT_FILES) {
    await copyFile(path.join(fontDir, `Vazirmatn-${w}.ttf`), path.join(dir, 'assets', 'fonts', `Vazirmatn-${w}.ttf`));
  }
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id: spec.id, name: spec.id }, null, 2));
  await writeFile(
    path.join(dir, 'hyperframes.json'),
    JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }, null, 2),
  );
  await writeFile(path.join(dir, 'index.html'), buildHtml(spec, { imageFiles, hasMusic }));
}
