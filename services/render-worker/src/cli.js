// Local render without Telegram or Redis:
//   node src/cli.js specs/eresidency-fa.json [--no-images] [--out out.mp4]

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { copyOut, renderSpec } from './pipeline.js';

const args = process.argv.slice(2);
const specPath = args.find((a) => a.endsWith('.json'));
if (!specPath) {
  console.error('usage: node src/cli.js <spec.json> [--no-images] [--out file.mp4]');
  process.exit(1);
}
const outIdx = args.indexOf('--out');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const r = await renderSpec(spec, { skipImages: args.includes('--no-images'), onProgress: (t) => console.log(t) });
const dest = outIdx > -1 ? args[outIdx + 1] : path.join('out', `${spec.id}.mp4`);
await copyOut(r.file, dest);
console.log(JSON.stringify({ ...r, file: dest }, null, 2));
