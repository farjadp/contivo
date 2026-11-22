# Claude web search: citations for competitor discovery

Owner: contivo-llm-engineer. Date: 2026-11-22. Code: `apps/web/src/lib/ai/providers/anthropic.ts`
(`CLAUDE_COMPETITOR_SEARCH_SYSTEM`, `COMPETITOR_SEARCH_MAX_USES`). Harness: `docs/evals/claude-search-citations/run.mjs`.

**Status: the change is built and unit-tested, but it has not been measured live.** No Anthropic key
was available to this session, and no funded OpenAI key exists (the local key returned 429 on
22 Nov, and the production key has no credit either). Every "result" cell below stays empty until the
harness runs. Do not merge on the strength of this note alone.

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

Other tasks, other providers, JSON-output requests and the citations-only rule are unchanged.

## Questions the live run must answer

The 3 queries are in `run.mjs`: 2 in English (country CA) and 1 in Persian (country IR).

| Variant | Tool | Instruction | max_uses | Effort | Citations / query | Cited domains that are the company's own site | Listicle / directory domains | Cost / query |
|---|---|---|---|---|---|---|---|---|
| `base_dyn` (production before) | 20260209 | none | — | low | | | | |
| `base_basic` | 20250305 | none | — | low | | | | |
| `base_direct` | 20260209 direct | none | — | low | | | | |
| `sys_dyn` | 20260209 | Claude | — | low | | | | |
| `sys_basic` | 20250305 | Claude | — | low | | | | |
| `sys_dyn_mu5` | 20260209 | Claude | 5 | low | | | | |
| `sys_basic_mu5` | 20250305 | Claude | 5 | low | | | | |
| `sys_basic_med` | 20250305 | Claude | — | medium | | | | |
| **`impl`** (this PR) | 20260209 direct | Claude | 5 | low | | | | |
| OpenAI `gpt-5-mini` (reference) | `web_search` | — | — | — | | | | |

Pass bar for `impl`: at least 1 citation on every query, in en and fa, and at least half of the cited
domains are the companies' own sites. If listicle publishers dominate the citations, the adapter fix
is not enough. The publishers would become wrong candidates, and the next step is a candidate filter
in `search.ts` (out of scope here).

Also unverified: whether `user_location.country: "IR"` is accepted. The docs say an unsupported
country code returns 400. If it fails, Persian runs need another way to set the country.

## How to run

Run from the repo root, with a key in the environment. Each run costs about 3 queries × variants
searches at $10/1k, plus tokens.

```bash
ANTHROPIC_API_KEY=… node docs/evals/claude-search-citations/run.mjs all 1
```

The harness reads the instruction from `anthropic.ts`, so it always tests what production sends.
Results go to `docs/evals/claude-search-citations/results/` (gitignored). Fill in the table above
from them.
