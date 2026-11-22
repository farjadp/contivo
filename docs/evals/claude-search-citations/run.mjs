// Live experiment: does Claude web search return web_search_result_location
// citations for Contivo's competitor-search prompt, and to which domains?
// Usage: node claude-cite.mjs <variant,...|all> [reps]
// Key: ANTHROPIC_API_KEY from env (never printed).
import { createRequire } from 'node:module';
import fs from 'node:fs';

// Run from the repo root: node docs/evals/claude-search-citations/run.mjs <variants> [reps]
const WEB = new URL('../../../apps/web/package.json', import.meta.url).pathname;
const require = createRequire(WEB);
const Anthropic = require('@anthropic-ai/sdk').default;

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY unset'); process.exit(2); }
const client = new Anthropic({ maxRetries: 1 });
const MODEL = process.env.EXP_MODEL || 'claude-sonnet-5-5';

export const QUERIES = [
  { q: 'online store builder platform for small businesses', country: 'CA', lang: 'en' },
  { q: 'AI content marketing software for small business', country: 'CA', lang: 'en' },
  { q: 'فروشگاه ساز اینترنتی', country: 'IR', lang: 'fa' },
];
// The API rejects some markets' country codes (live 22 Nov: "Country code IR is not supported").
// EXP_NO_COUNTRY=IR sends those queries without user_location, as the adapter now does.
const NO_COUNTRY = new Set((process.env.EXP_NO_COUNTRY || '').split(',').filter(Boolean));

// Current production prompt (search.ts buildSearchPrompt).
const basePrompt = (q) => `Search the web for: "${q}". List the companies or products that offer this, each with its website. Be brief.`;

// Read from the adapter so the eval always tests the instruction production sends.
const ADAPTER = fs.readFileSync(new URL('../../../apps/web/src/lib/ai/providers/anthropic.ts', import.meta.url), 'utf8');
const block = ADAPTER.slice(ADAPTER.indexOf('CLAUDE_COMPETITOR_SEARCH_SYSTEM = ['), ADAPTER.indexOf("].join(' ')", ADAPTER.indexOf('CLAUDE_COMPETITOR_SEARCH_SYSTEM = [')));
const CLAUDE_SYSTEM = [...block.matchAll(/^\s*(['"])(.+)\1,$/gm)].map((m) => m[2]).join(' ');
if (CLAUDE_SYSTEM.length < 200) throw new Error('could not read CLAUDE_COMPETITOR_SEARCH_SYSTEM from anthropic.ts');

const VARIANTS = {
  // name: { tool, system?, effort, maxUses? }
  base_dyn: { tool: 'web_search_20260209', effort: 'low' },
  base_basic: { tool: 'web_search_20250305', effort: 'low' },
  sys_dyn: { tool: 'web_search_20260209', effort: 'low', system: CLAUDE_SYSTEM },
  sys_basic: { tool: 'web_search_20250305', effort: 'low', system: CLAUDE_SYSTEM },
  sys_basic_mu5: { tool: 'web_search_20250305', effort: 'low', system: CLAUDE_SYSTEM, maxUses: 5 },
  sys_dyn_mu5: { tool: 'web_search_20260209', effort: 'low', system: CLAUDE_SYSTEM, maxUses: 5 },
  sys_basic_med: { tool: 'web_search_20250305', effort: 'medium', system: CLAUDE_SYSTEM },
  // What the adapter sends now (anthropic.ts, competitor_web_search).
  impl: { tool: 'web_search_20260209', effort: 'low', system: CLAUDE_SYSTEM, maxUses: 5, direct: true },
  base_direct: { tool: 'web_search_20260209', effort: 'low', direct: true },
};

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

async function runOne(variantName, v, { q, country }) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: basePrompt(q) }],
    output_config: { effort: v.effort },
    tools: [{ type: v.tool, name: 'web_search', ...(v.direct ? { allowed_callers: ['direct'] } : {}), ...(v.maxUses ? { max_uses: v.maxUses } : {}), ...(NO_COUNTRY.has(country) ? {} : { user_location: { type: 'approximate', country } }) }],
  };
  if (v.system) params.system = v.system;
  const t0 = Date.now();
  let blocks = []; let msg; let turns = 0;
  try {
    for (;;) {
      msg = await client.messages.create(params, { timeout: 150_000 });
      blocks.push(...msg.content); turns++;
      if (msg.stop_reason !== 'pause_turn' || turns > 4) break;
      params.messages = [...params.messages, { role: 'assistant', content: msg.content }];
    }
  } catch (e) {
    return { variant: variantName, q, error: `${e.status ?? ''} ${e.message}`.slice(0, 300) };
  }
  const citations = []; const sources = []; let searches = 0; const errors = []; let text = '';
  for (const b of blocks) {
    if (b.type === 'text') { text += b.text; for (const c of b.citations ?? []) if (c.type === 'web_search_result_location') citations.push(c.url); }
    if (b.type === 'server_tool_use' && b.name === 'web_search') searches++;
    if (b.type === 'web_search_tool_result') { if (Array.isArray(b.content)) for (const r of b.content) sources.push(r.url); else errors.push(b.content.error_code); }
  }
  return {
    variant: variantName, q, model: msg.model, stop: msg.stop_reason, ms: Date.now() - t0, turns, searches,
    webSearchRequests: msg.usage?.server_tool_use?.web_search_requests,
    sources: sources.length, citations: citations.length,
    citedDomains: [...new Set(citations.map(host).filter(Boolean))],
    citedUrls: [...new Set(citations)],
    sourceDomains: [...new Set(sources.map(host).filter(Boolean))],
    errors, blockTypes: blocks.map((b) => b.type).join(','),
    inTok: msg.usage?.input_tokens, outTok: msg.usage?.output_tokens,
    text: text.slice(0, 1500),
  };
}

const arg = process.argv[2] || 'all';
const reps = Number(process.argv[3] || 1);
const names = arg === 'all' ? Object.keys(VARIANTS) : arg.split(',');
const out = [];
for (const name of names) {
  for (let r = 0; r < reps; r++) {
    const rows = await Promise.all(QUERIES.map((qq) => runOne(name, VARIANTS[name], qq)));
    for (const row of rows) {
      out.push({ rep: r, ...row });
      console.log(JSON.stringify({ v: row.variant, q: row.q, s: row.searches, src: row.sources, cit: row.citations, cited: row.citedDomains, err: row.error ?? row.errors, ms: row.ms }));
    }
  }
}
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/${Date.now()}.json`, import.meta.url);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log('wrote', file.pathname);
