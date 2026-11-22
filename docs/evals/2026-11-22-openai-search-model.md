# OpenAI competitor-search model: replacing gpt-5-mini

Owner: contivo-head-of-data. Date: 2026-11-22. Code: `DEFAULT_OPENAI_SEARCH_MODEL` in
`apps/web/src/lib/ai/models.ts`.

**Decision: `gpt-6.2-sol`.** gpt-5-mini shuts down on **2026-12-11**. OpenAI's deprecations
page names `gpt-6.1-terra` as its replacement, but terra failed one English query in both
runs, so sol was chosen instead.

## Method

Each model was called live on 22 Nov with the production OpenAI key, through the real
`runAiTask('competitor_web_search', …)` path and `buildSearchPrompt`, with the chain pinned
to OpenAI. A "domain" below is a distinct competitor domain from **citations only**, since
citations are the only thing `search.ts` builds a candidate from.

Queries:
- en1: `online store builder platform for small businesses` (country CA)
- en2: `AI content marketing software for small business` (country CA)
- fa: `فروشگاه ساز اینترنتی` (no country)

Runs: 1 run for every model, plus a second run for terra and sol. Cost per query = tokens at
list price + $0.01 per web search call. Prices are from developers.openai.com/api/docs/pricing,
read 22 Nov.

## Results

| Model | $ in / out per 1M | en1 domains | en2 domains | fa domains | p50 latency | max | $ / query |
|---|---|---|---|---|---|---|---|
| gpt-5-mini (today) | 0.25 / 2 | 16 | 16 | 13 | 34.4 s | 54.3 s | 0.062 |
| gpt-6.1-terra (OpenAI's pick) | 1 / 5 | **1, 1** | 7, 7 | 8, 10 | 14.0 s | 17.5 s | 0.044 |
| gpt-6-luna | 0.10 / 0.50 | **1** | 6 | 9 | 12.5 s | 15.0 s | 0.029 |
| **gpt-6.2-sol** | 2 / 10 | 8, 8 | 7, 5 | 8, 7 | **11.9 s** | 13.5 s | 0.058 |

Persian quality (fa citations):
- **sol:** portal.ir, sazito.com, shopfa.com, webzi.ir, digify.shop, bahooosh.com,
  farasoft.com, sabad.io, mixin.ir. These are real Iranian store builders.
- **terra (second run):** the same set.
- **gpt-5-mini:** more domains, but mixed with news and rankings sites (startupranking.com,
  digiato.com, topshops.ir).
- **luna:** mixed with noise (telegramchannels.me, trustmrr.ir, rankesh.com).

## Why sol

- **Steady.** Every query gave 5 to 8 clean competitor domains in both runs. terra and luna
  returned a single citation (shopify.com) for en1, and terra did so on both runs. A query
  like that would have contributed almost nothing to a discovery run.
- **About 3× faster than gpt-5-mini.** p50 latency fell from 34 s to 12 s. gpt-5-mini's
  54 s worst case is a large share of the 150 s per-query budget.
- **Same cost.** $0.058 vs $0.062 per query: fewer tokens and fewer search calls offset the
  higher token price.
- **Fewer domains than gpt-5-mini, but cleaner ones.** The judge stage discards non-competitors
  anyway.
- **No announced shutdown** on the deprecations page as of 22 Nov.

## Limits

- n = 1–2 runs per model, on 3 queries. This is enough to rule out terra and luna for en1,
  but it is not a full eval.
- Re-run before changing the model again. To reproduce, copy the query loop from this note
  into a live test, as in the claude-search-citations harness.
- `OPENAI_SEARCH_MODEL` still overrides the default without a deploy.
