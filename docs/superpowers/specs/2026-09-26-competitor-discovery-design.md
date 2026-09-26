# Competitor Discovery — Redesign

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, awaiting written-spec review
- **Branch:** `competitor-discovery-redesign`

## 1. Why

Discovery today (`discoverWorkspaceCompetitors`, `apps/web/src/app/actions/growth-competitors.ts`) asks GPT-4.1 to name competitors from memory, with no search, and "validates" them with a DNS lookup and an HTTP GET. That proves a domain exists, not that it competes. On top of that:

- The prompt has no market or geography. `dataforseo.ts` hardcodes `location_code 2840` / `language_code 'en'`.
- Rejections are stored but never sent back to the model, so the same rejected names come back and use up the limited runs.
- Structured output (confidence, positioning, reason, features) gets flattened into one `description` string.
- The user sees no evidence for why a company counts as a competitor.
- Discovery runs synchronously inside a server action: up to 12 candidates, each with sequential DNS and HTTP calls on 4s timeouts.
- Failed runs still count against the quota.
- The orphan page `/growth/competitors` defaults unreviewed competitors to ACCEPTED, and its map positions come from `sin(i)` / `cos(i)`. The live map in `CompetitorMapManager` places competitors using regex heuristics over description text.

**Goal:** competitors that are real, relevant and matched to the right market and scale. Every one should carry evidence the user can click, be labelled by *how* it competes (SEO vs business), and get better with each review.

## 2. Decisions (approved)

| # | Decision |
|---|---|
| D1 | Full rebuild. Approach **C**: a multi-source pipeline, a judge, and structured storage. |
| D2 | Target market comes from the workspace (`targetCountry` + `targetLanguage`) and is editable. It is separate from `contentLanguage`. |
| D3 | "Competitor" means both kinds, labelled: `SEO` and/or `BUSINESS`. |
| D4 | **Candidate domains come only from real search results, never from model prose.** |
| D5 | The primary source is **OpenAI Responses API `web_search`**. The SERP source (DataForSEO) is designed in but switched off. Gemini grounding is out (429 on the current key). |
| D6 | Failed or empty runs do **not** count against the quota. |
| D7 | At most **10** competitors saved per run. |
| D8 | Downstream fallback, option **B**: use ACCEPTED competitors. If there are none, use only PENDING competitors with **high** confidence, and label the resulting output "based on unconfirmed competitors". |
| D9 | Delete the orphan `/growth/competitors` page and the heuristic map in the discovery UI. *(Recommended in Section 3. The user did not object; confirm at spec review.)* |

## 3. Spike evidence (2026-09-26, throwaway code, not in repo)

We ran OpenAI `web_search` with `gpt-5-mini` on 6 queries (3 fa/IR, 3 en).

- Domains cited in the answer's annotations were mostly real, relevant companies. Raw `sources` (26–112 domains per query) were mostly noise, so we use them only as a frequency signal.
- Persian results were strong for the accounting-software and mentorship queries. The Iranian store-builder query was poor: the main players showed up **only** as stat-mirror hosts (`sazito.com.atlaq.com`, `kamva.ir.usitestat.com`), which means normalisation is required (§5.3).
- Generic English queries surface giants (HubSpot, Mailchimp). Scale matching has to be a hard judge rule.
- Each query took 17–98s and 20k–78k tokens. Cost has to be measured and reduced (§8).

## 4. Data model (Prisma, applied with `db push`)

### Workspace
```prisma
targetCountry  String?   // ISO 3166-1 alpha-2, e.g. "IR", "CA"; null = global
targetLanguage String    @default("en") // search language: "fa" | "en"
```
Backfill: `contentLanguage = FA` → `IR` / `fa`; otherwise `null` / `en`. The user can edit both in the discovery panel and in workspace settings.

### Competitor (new fields; existing fields unchanged)
```prisma
confidence      Float?
labels          String[]  @default([])   // "SEO" | "BUSINESS"
sources         String[]  @default([])   // "WEB_SEARCH" | "SERP" | "MANUAL"
evidence        Json?     // EvidenceItem[]
positioning     String?
keyFeatures     String[]  @default([])
rejectionReason String?   // "DIFFERENT_MARKET" | "TOO_BIG" | "DIFFERENT_PRODUCT" | "NOT_A_COMPANY" | free text
discoveryRunId  String?
```
`EvidenceItem = { kind: 'citation' | 'serp' | 'site'; url: string; title?: string; snippet?: string; query?: string }`

`description` goes back to being a plain description. Legacy rows keep their flattened string and `confidence = null`. There is no parse-back migration.

### DiscoveryRun (new)
```prisma
model DiscoveryRun {
  id           String    @id @default(cuid())
  workspaceId  String
  userId       String
  status       String    // PENDING | RUNNING | DONE | EMPTY | FAILED
  stage        String?   // QUERIES | SEARCH | ENRICH | JUDGE | SAVE
  market       Json      // { country, language } snapshot
  queries      Json?     // string[]
  sourceStats  Json?     // per source: harvested, after filter, enriched, judged, kept
  savedCount   Int       @default(0)
  tokensUsed   Int       @default(0)
  error        String?
  startedAt    DateTime  @default(now())
  finishedAt   DateTime?
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, startedAt])
  @@map("discovery_runs")
}
```
**Quota** = count of runs with `status = DONE`. The limit stays `getCompetitiveLandscapeLimit()`. The legacy activity-log archive stays readable in run history and counts toward usage, so existing users don't get a quota reset.

## 5. Pipeline

### 5.0 Trigger and execution
The server action checks ownership and quota, refuses if a run is already PENDING/RUNNING for the workspace, creates a `DiscoveryRun (PENDING)`, schedules the pipeline with Next's `after()` in a route that has `maxDuration = 300` (same precedent as `/api/autopilot/tick`), and returns the run id right away. The UI polls a server action that reads the run row.

- The DB row is the only source of truth. If a run has been RUNNING for more than 10 minutes, it is marked `FAILED` the next time it is read, and it doesn't count toward the quota.
- *Why not BullMQ on Railway:* the `ANALYSIS` queue exists but has no processor, and every piece of discovery (OpenAI helpers, `collectWebsiteEvidence`, Prisma access) lives in `apps/web`. Moving it would mean porting or duplicating that code for no user-visible gain. Revisit if runs regularly get near 300s.

### 5.1 Brand brief (deterministic)
Built from `brandSummary`, the target market, the own domain, accepted competitors (positive examples), rejected competitors with their reasons (negative examples), and the domains already known.

### 5.2 Query generation (1 LLM call, structured output)
6–8 queries in `targetLanguage`, spread across these categories:
- category + market
- audience problem
- "alternatives to {accepted competitor}"
- "{accepted competitor} vs"

The alternatives and vs queries only apply once accepted competitors exist. Queries are saved on the run and shown in the UI.

### 5.3 Harvest (sources run in parallel, concurrency ≤ 4)
- **WEB_SEARCH:** OpenAI `web_search`, with `user_location.country = targetCountry` when set. Candidates come from **annotation URLs only**. Raw `sources` feed a per-domain frequency count.
- **SERP:** interface only, and returns `[]` until DataForSEO credentials exist. It must never return mock data.
- **Normalisation** (`normalizeCandidateDomain`, a pure function with unit tests):
  1. Reduce to the registrable domain using the public suffix list (`tldts`).
  2. Unwrap stat-mirror hosts. `sazito.com.atlaq.com` → `sazito.com`, driven by a table of known mirror suffixes (`atlaq.com`, `usitestat.com`, `cutestat.com`, `clearwebstats.com`, …).
  3. Drop the never-a-company list: search engines, social networks and messengers, wikis, code hosts, and site-stat/tech-profiler sites.
- Exclude the own domain, rejected domains and existing domains.

### 5.4 Enrich
Take the top 20 by frequency and fetch each homepage with the existing `collectWebsiteEvidence` (concurrency 5). This yields title, meta description, headings and detected page language. Unreachable candidates are dropped. This replaces the DNS/HTTP check.

### 5.5 Judge (LLM, JSON-schema output, batched)
**Input:** the brand brief, each candidate's site evidence, and the queries and citations where it appeared.

**Output per candidate:** `isCompetitor`, `labels`, `type (DIRECT|INDIRECT|ASPIRATIONAL)`, `scaleMatch`, `confidence 0–1`, `reason` (must reference the evidence), `positioning`, `keyFeatures`.

**Hard rules:**
- A reason with no evidence reference means reject.
- Marketplaces, directories and media sites are rejected unless they genuinely sell the same thing.
- A scale mismatch means `ASPIRATIONAL`, never `DIRECT`.

### 5.6 Score (deterministic)
`final = judge.confidence` adjusted by query frequency, source agreement and page-language match with `targetLanguage`. The weights live in one exported function with unit tests. Keep `final ≥ 0.6` (to be tuned after real runs) and at most 10. Confidence bands shown to the user: **high ≥ 0.8**, **medium ≥ 0.6**.

### 5.7 Save
- Upsert by normalised domain. A user decision is **never** overwritten. New rows are `PENDING` with `source = 'AI'`.
- The run ends `DONE` if at least one competitor was saved, `EMPTY` if none survived, and `FAILED` on error.

### 5.8 Manual add
Enrich and judge run on the single domain. The competitor is saved as `ACCEPTED` with `sources = ['MANUAL']`. If the judge says it isn't a competitor, the UI shows a warning and the user decides. The judge's result is still saved as evidence. A manual add does not use up a run.

## 6. UI (single surface: the competitors section of the Growth workspace)

1. **Run panel:** "Searching in: {country} · {language} — change", a find button, and the quota. During a run it shows live stages and the queries. The user can leave the page while it runs. The empty and failed states say exactly what was searched and offer two next steps: change the market, or seed a competitor manually.
2. **Review queue (PENDING):** sorted by confidence. Each card shows name, linked domain, label chips, type, confidence as a word, a one-line reason, and an expandable "Why?" section with the queries, the citation links and the homepage summary.
   - Actions: accept, reject (with optional reason chips), change type.
   - Saved immediately, with an undo toast.
3. **My competitors (ACCEPTED):** a compact list where type can be edited or the competitor removed, plus manual add and a collapsed run history (date, market, queries, found/accepted counts).

**Removed:**
- the `/growth/competitors` route and `CompetitorsClient.tsx`
- the heuristic scatter map and the `estimate*Score` helpers in `CompetitorMapManager.tsx`
- the separate "save text edits" flow

Copy is written in both `en` and `fa`. The Persian is written as Persian, not translated (see the Persian copy standard), and numbers are formatted through `useFormatter`.

## 7. Downstream (D8)

One shared helper `selectCompetitorsForAnalysis(workspaceId)` returns `{ competitors, basis: 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE' }`. It replaces the ad-hoc filters in `growth-matrices.ts`, `growth-keywords.ts` and `growth-offerings.ts`. When `basis = UNCONFIRMED_HIGH`, those features store that fact and show the "based on unconfirmed competitors" label. Strategic reports, report eligibility and narrative stay ACCEPTED-only.

## 8. Cost and limits
- Record the token count of each run in `DiscoveryRun.tokensUsed`.
- Try `search_context_size: 'low'` first. Cap queries at 8 and enrichment at 20.
- Before rollout, measure 5 real workspaces (a mix of fa and en). If the median run costs more than an agreed ceiling, reduce the number of queries.

## 9. Error handling
- Each source fails on its own. One failed source produces a partial run, and its stats record the error.
- A missing `OPENAI_API_KEY` gives `FAILED` with a clear admin-facing error, uncharged.
- No silent fallbacks to invented data anywhere in the pipeline.

## 10. Testing
- **Unit:** domain normalisation, including the real mirror hosts from the spike; scoring; quota counting (DONE only, plus legacy); `selectCompetitorsForAnalysis`.
- **Integration:** a pipeline test with recorded OpenAI fixtures from the spike queries, covering: rejected domains never reappear, user decisions are never overwritten, the run caps at 10.
- **Live verification:** run against the local app on one Persian and one English workspace, and confirm the evidence links, stages and quota in the UI (see the verification habit; a human signs in).

## 11. Out of scope
- Fixing the DataForSEO mock fallback in production. That is a separate task, already spawned. Until it lands, the SERP source stays off.
- Parameterising DataForSEO location/language from `targetCountry`. That comes with the fix above.
- Gemini grounding. Revisit if the quota tier changes.
- Redesigning Competitive Matrices.

## 12. Open for spec review
1. Confirm D9 (the deletions).
2. The cost ceiling per run for §8.
