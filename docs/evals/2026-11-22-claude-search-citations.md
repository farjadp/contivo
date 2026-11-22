# Claude web search: citations for competitor discovery

Owner: contivo-llm-engineer. Date: 2026-11-22. Code: `apps/web/src/lib/ai/providers/anthropic.ts`
(`CLAUDE_COMPETITOR_SEARCH_SYSTEM`, `COMPETITOR_SEARCH_MAX_USES`). Harness: `docs/evals/claude-search-citations/run.mjs`.

**Status: measured live on 22 Nov with a dev Anthropic key, model `claude-sonnet-5-5`, effort `low`.**
The setup in this PR (`impl`) cited the companies' own sites on every query, in English and Persian,
across 2 runs. With the production setup (`base_dyn`), 0 of 9 queries produced a citation. OpenAI
could not be compared: the only active OpenAI key returns 429 `credit_balance_exhausted`, so it was
treated as unavailable.

## The problem

`search.ts` creates a competitor candidate only from a `web_search_result_location` citation. Result
URLs (`sourceUrls`) can only raise a candidate's frequency. That anti-fabrication rule stays.

On production on 22 Nov, OpenAI had no credit, so `competitor_web_search` fell through to Claude
(`claude-sonnet-5-5`). The prompt was `buildSearchPrompt(q)`. Results:

| Tool | Searches | Sources | Citations | Response shape |
|---|---|---|---|---|
| `web_search_20260209` (dynamic filtering) | 1 | 9 | **0** | `code_execution` → `web_search` caller blocks |
| `web_search_20250305` (basic) | 1 | 9 | **0** | one text block, no citations |

Source: the AI-failover session's live run. These figures were reported to this session, not
re-measured here. Claude wrote each company's homepage from memory. A citation attaches only to text
drawn from a search result, so no citation came back, and every query produced zero candidates. Since
PR #26 such a query counts as an error, so the run ends FAILED and the user is not charged.

## What changed (Claude only, `competitor_web_search` only)

1. **A Claude-only system instruction.** It asks Claude to name only companies that appear in the
   results, to base each line on the result where the company appears (so that result is cited), to
   prefer the company's own site, and to search the company by name when it appears only in a list
   article. It also says never to write a company or a URL from memory. The user prompt is still the
   shared `buildSearchPrompt`.
2. **Direct search** (`allowed_callers: ['direct']` on `web_search_20260209`). Dynamic filtering runs
   the search inside code execution and passes the model only what its code keeps. With direct
   search, the model reads the results itself, and citations point into those results. This is also
   ZDR-eligible; dynamic filtering is not.
3. **`max_uses: 5` by default.** This leaves room for one broad search plus follow-up searches for
   companies' own sites. An explicit `webSearch.maxUses` still wins.
4. **Country codes the API rejects** (IR, measured) are never sent as `user_location`, and any other
   "country code not supported" 400 is retried once without the location. This applies to all
   Claude web searches.

Other tasks, other providers, JSON-output requests and the citations-only rule are unchanged.

## Live results (22 Nov)

Queries: `online store builder platform for small businesses` (en, CA), `AI content marketing software
for small business` (en, CA), `فروشگاه ساز اینترنتی` (fa, IR). Raw JSON lives in
`claude-search-citations/results/`, which is gitignored.

**Finding 1: country `IR` returns 400.** Every fa query with `user_location.country: "IR"` failed
with `tools.0.web_search_2026…: Country code IR is not supported.`, on both tool versions. Claude
fallback was therefore failing outright for every Iranian-market workspace, before citations even
came into it. Fix: IR is never sent as `user_location`, and any other "country code not supported"
400 is retried once without the location. The fa rows below ran without a country.

**Finding 2: dynamic filtering never cites.** `web_search_20260209` through code execution produced 0
citations in every run, with or without the instruction. With the instruction plus direct search,
citations appear on every query.

Citations per query, en1 / en2 / fa. `—` = 400 (IR). Runs: r1 had IR on; r2 and r3 were the
repeat with IR dropped.

| Variant | Tool | Instruction | max_uses | Effort | r1 | r2 | r3 |
|---|---|---|---|---|---|---|---|
| `base_dyn` (production before) | 20260209 | none | — | low | 0 / 0 / — | 0 / 0 / 0 | 0 / 0 / 0 |
| `base_basic` | 20250305 | none | — | low | 1 / 0 / — | | |
| `base_direct` | 20260209 direct | none | — | low | 0 / 0 / — | | |
| `sys_dyn` | 20260209 | Claude | — | low | 0 / 0 / — | | |
| `sys_dyn_mu5` | 20260209 | Claude | 5 | low | 0 / 0 / — | | |
| `sys_basic` | 20250305 | Claude | — | low | 7 / 6 / — | 7 / 5 / 7 | 7 / 3 / 7 |
| `sys_basic_mu5` | 20250305 | Claude | 5 | low | 6 / 7 / — | | |
| `sys_basic_med` | 20250305 | Claude | — | medium | 8 / 6 / — | | |
| **`impl` (this PR)** | 20260209 direct | Claude | 5 | low | 6 / 5 / — | 5 / 6 / 7 | 6 / 6 / 7 |
| OpenAI `gpt-5-mini` | `web_search` | — | — | — | not run: 429 no credit | | |

Through the real adapter (`anthropicAdapter.call`, `competitor_web_search`), live:
- fa with country IR: 7 citations, 1 search, 14.6k tokens, 3.3 s.
- `نرم افزار حسابداری ابری` with country KP: 6 citations.

**Own site or listicle?** Cited domains for `impl`, r2:
- Store builders (en): turbify, shopify, wix, squarespace, squareup. All 5 are own sites.
- AI content marketing (en): blaze.ai, jasper.ai and docs.surferseo.com are own sites. averi.ai and
  constantcontact.com are vendors' own domains, but the cited page is each one's "best AI tools"
  guide. comparateur-ia.com is a directory, which makes it a wrong candidate.
- fa: shopfa, sepehrcc, see5, bahooosh, webzi.ir, webpouya and parmisit. All 7 are companies' own
  pages.

Overall, 1 of 18 cited domains is a listicle/directory publisher. The competitor judge stage exists
to drop such domains. The pass bar was met: at least 1 citation per query in en and fa, and at least
half of the cited domains are own sites.

**Direct `20260209` vs basic `20250305`:** both call search directly, and with the instruction they
gave the same citation counts and domains. The PR keeps the newer tool version with
`allowed_callers: ['direct']`.

**max_uses:** without a cap, Claude ran 4–7 searches. With 5 it runs 5 (en) or 1 (fa). The cap bounds
cost and did not cost citations.

**Cost per query** at Sonnet 5.5 rates ($2 / $10 per M tokens, $10 per 1k searches):

| | Searches | Input tokens | Output tokens | ≈ $/query |
|---|---|---|---|---|
| `base_dyn` (before), en | 1 | ~20k | ~0.5k | ~$0.06 |
| `impl`, en | 5 | ~57–61k | ~0.8–1.2k | ~$0.18 |
| `impl`, fa | 1 | ~14k | ~0.4k | ~$0.04 |

`impl` costs about 3× more in English. Before, though, the money bought a FAILED run. If cost matters,
lowering the cap to 3 is the next thing to measure.

**Not measured:** OpenAI (no credit), the same queries on other Claude models, and more than 2 runs
per setup.

## How to run

Run from the repo root, with a key in the environment (never commit it). `EXP_NO_COUNTRY=IR` sends
IR queries without a location, as the adapter does.

```bash
EXP_NO_COUNTRY=IR node docs/evals/claude-search-citations/run.mjs base_dyn,impl 2
```

The harness reads the instruction from `anthropic.ts`, so it always tests what production sends.
Results go to `docs/evals/claude-search-citations/results/` (gitignored).
