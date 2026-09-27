# Positioning Matrices — Redesign

- **Date:** 2026-09-26
- **Status:** Draft for review. **Do not implement until the competitor-discovery redesign has landed** (see §11).
- **Branch:** `competitor-discovery-redesign` (spec only); implementation on its own branch after discovery.
- **Depends on:** `2026-09-26-competitor-discovery-design.md` (§4 Competitor fields, §7 selector, §5.0 async run pattern). Final names from the discovery session (2026-09-26): `selectCompetitors()` in `apps/web/src/lib/competitors/selection.ts` returning `{ competitors, basis: 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE' }`; `triggerBackgroundRun(path, body)` in `apps/web/src/lib/background-run.ts`, which returns `{ ok, error }` and has a 10s dispatch timeout; evidence items carry a stable `id` (requested, agreed); confidence bands shared: high ≥ 0.8, medium ≥ 0.6, shown as a word never a percentage; `Workspace.targetLanguage` exists separately from `contentLanguage`..

## 1. Why

Today (`generateWorkspaceCompetitiveMatrices`, `apps/web/src/app/actions/growth-matrices.ts`):

- The model receives **only text** (name, domain, description, category, audienceGuess, brandSummary). No site evidence, no pricing, no content or keyword data. Scores are recalled, not observed.
- **Five fixed axes for every market.** "Strategy vs Execution" and "Creativity vs Structure" are not measurable. A Persian accounting SaaS and a Canadian consultant get the same five charts.
- **The fallback invents data.** When OpenAI fails, scores are derived from a string hash, saved with `source: 'AI'` and confidence 0.42, and that fake payload opens the ideation gate. This contradicts PRODUCT.md ("refuses to write until it has intelligence") and discovery §9 ("no silent fallbacks to invented data").
- **One call scores ~130 numbers** (5 charts × ≤13 companies × 2 axes) with `json_object`, not a schema.
- **Storage is one JSON blob** in `workspace.audienceInsights.competitiveMatrices`: no history, no link to `Competitor.id` (matched by name+domain), and **every regenerate erases the user's manual edits**.
- Reasons are free text with no evidence link; confidence is self-declared by the model.
- Axis names and reasons arrive in English regardless of `contentLanguage`.
- `strategic-report-builder.ts` reads `matrices.insights.marketPatterns`, a key that has never existed in the stored shape. (Bug, fixed in §8.)

**Goal (decided 2026-09-26):** the matrices exist to make content. Each chart must answer three things for the ideation engine and the narrative layer: *where do we stand*, *where is the open space*, and *which audience owns that space*. Every score must be traceable to evidence, editable without being lost, and written in the workspace's language.

## 2. Decisions

| # | Decision | Status |
|---|---|---|
| M1 | Rebuild on evidence + structured storage (options B + D from the brainstorm). Cosmetic prompt polish alone is rejected: it makes guesses look better. | proposed |
| M2 | **Axes = 2 core + 1–3 market-specific** (3–5 charts). Core charts are identical across workspaces so downstream code can rely on them; market charts are proposed by the model from the brand brief and competitor positioning, and the user picks/renames them. | proposed |
| M3 | **Fail closed.** No heuristic fallback. A failed run saves nothing; the ideation gate stays shut with a clear message. | proposed |
| M4 | Manual score edits live in an **override layer** that survives regeneration, is visible on the chart, and can be reset per point. | approved (Q4) |
| M5 | Competitor input comes only from `selectCompetitors` (discovery §7). `basis` is stored on the run, mirrored as `competitor_basis` on the projection (the key discovery already writes), and shown in the UI. Note the landed contract is stricter than first agreed: `UNCONFIRMED_HIGH` needs high confidence **and** corroboration (citations from at least 2 distinct queries, or more than one source), so a matrix run can legitimately refuse where the old filter would have proceeded. | proposed |
| M6 | Evidence bundle is limited to what the app already holds: discovery `evidence`, `positioning`, `keyFeatures`, `labels`, `confidence`, own-site `brandSummary`, and `competitorKeywordsIntel` when present. **No new crawling or paid data in this iteration** (Q3). Deferred items are tracked in Notion Mission Control. | approved (Q3) |
| M7 | Output language = workspace `contentLanguage` (the content is for the customer's audience; `targetLanguage` is the search language and is passed to the prompt only as market context). Core axis labels come from i18n, never from the model. | proposed |
| M8 | The token-usage panel leaves the main UI and becomes a collapsed technical disclosure. | proposed |
| M9 | **Certainty is an enum, not a self-reported float.** The scorer returns `certain` / `likely` / `unsure`, mapped in code to 0.9 / 0.7 / 0.5, then adjusted only by deterministic signals. Measured live in discovery (2026-09-26), a model's own 0-1 confidence pinned at 1.0 for every candidate including ones it rejected, so the number carried no information. | proposed |
| M10 | **Every fabricating fallback in the intelligence actions goes**, not just the matrices one: `fallbackMatrices`, `fallbackKeywordPayload` (growth-keywords.ts) and `fallbackPayload` (growth-offerings.ts) all invent output when the OpenAI call fails, with real competitors attached, and it reads as genuine analysis. Verified still live on `competitor-discovery-redesign` at 7a035f8. | proposed |
| M11 | Schema changes ship as a **migration file**, not `db push`: production is migrated, and the branch already carries `20260926000000_competitor_discovery`. | proposed |

## 3. Axes

### 3.1 Core (always present, kind `CORE`)

Chosen because both ends can be argued from evidence the app already has.

| key | X | Y | Evidence sources |
|---|---|---|---|
| `offer_breadth_specialization` | Breadth of offer (1 = one thing, 10 = full suite) | Specialization (1 = generalist, 10 = niche expert) | `keyFeatures`, `positioning`, site headings, brandSummary offers |
| `content_presence_focus` | Content presence (1 = almost none, 10 = publishing machine) | Content focus (1 = scattered topics, 10 = tightly themed) | Site evidence (blog/nav headings, discovery `site` items). `competitorKeywordsIntel` is used **only** once it carries a provenance flag proving it came from live DataForSEO: today `lib/dataforseo.ts` returns unmarked mock data whenever `NODE_ENV === 'development'` or credentials are missing (verified 2026-09-26, `serp_analyses` empty locally), and the stored intel has no source field. Until the DataForSEO fix adds `data_source: 'LIVE' \| 'MOCK'`, treat keyword intel as absent. If no site evidence exists either, the point is `estimated` (§5.4). |

### 3.2 Market (kind `MARKET`, 1–3 charts, default 2)

One LLM call (structured output) proposes **4 candidate axis pairs** from the brand brief and the competitors' `positioning` strings. Each candidate has `x`, `y`, a one-line rationale, and the evidence fields it would rely on. The user picks up to 3, may rename labels, and the choice is saved on the workspace (`Workspace.matrixAxes Json`) so the next run reuses it without asking. Examples the spike should produce for an Iranian accounting SaaS: "Compliance depth vs Ease of use", "SMB focus vs Enterprise focus".

Rules for candidates: both ends must be observable in the evidence bundle; no axis may duplicate a core axis; no "strategy", "creativity", "execution" style abstractions.

### 3.3 Minimum

A run needs ≥ 2 usable competitors and produces ≥ 3 charts (2 core + ≥ 1 market). `REQUIRED_MATRIX_CHARTS` in `report-readiness.ts` goes from 5 to 3.

## 4. Data model (Prisma, `db push`)

```prisma
model MatrixRun {
  id            String    @id @default(cuid())
  workspaceId   String
  userId        String
  status        String    // PENDING | RUNNING | DONE | FAILED
  stage         String?   // AXES | SCORE | SUMMARISE | SAVE
  basis         String    // ACCEPTED | UNCONFIRMED_HIGH  (from selectCompetitorsForAnalysis)
  language      String    // "fa" | "en" snapshot of contentLanguage
  competitorSet Json      // [{ competitorId, domain, type }] snapshot used for staleness
  axesUsed      Json      // [{ key, kind, x, y }]
  tokensUsed    Int       @default(0)
  error         String?
  startedAt     DateTime  @default(now())
  finishedAt    DateTime?
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  charts        MatrixChart[]
  @@index([workspaceId, startedAt])
  @@map("matrix_runs")
}

model MatrixChart {
  id            String   @id @default(cuid())
  runId         String
  workspaceId   String
  key           String   // core key or market slug
  kind          String   // CORE | MARKET
  order         Int
  xLabel        String
  yLabel        String
  marketPattern String
  opportunity   String   // must reference the computed white space (§5.5)
  contentAngles Json     // [{ angle, audienceSegment }] max 3
  whiteSpace    Json     // { xBand, yBand, nearestCompetitorDistance }
  run           MatrixRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  scores        MatrixScore[]
  @@index([workspaceId, key])
  @@map("matrix_charts")
}

model MatrixScore {
  id            String   @id @default(cuid())
  chartId       String
  competitorId  String?  // null = TARGET (the workspace itself)
  name          String
  domain        String
  type          String   // TARGET | DIRECT | INDIRECT | ASPIRATIONAL
  xScore        Int
  yScore        Int
  xReason       String
  yReason       String
  evidenceRefs  Json     // string[] of stable evidence item ids (Competitor.evidence[].id)
  confidence    Float
  estimated     Boolean  @default(false) // true when evidenceRefs is empty
  chart         MatrixChart @relation(fields: [chartId], references: [id], onDelete: Cascade)
  @@map("matrix_scores")
}

model MatrixOverride {
  id            String   @id @default(cuid())
  workspaceId   String
  chartKey      String
  competitorId  String?  // null = TARGET
  xScore        Int?
  yScore        Int?
  note          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([workspaceId, chartKey, competitorId])
  @@map("matrix_overrides")
}
```

`Workspace.matrixAxes Json?` stores the chosen market axes.

**Projection.** After every run and every override, the server rebuilds `audienceInsights.competitiveMatrices` in the **existing payload shape** (charts / companies / x_score / summary / cross_chart_summary / strongest_differentiation_opportunity) with overrides applied, plus new fields `basis`, `stale`, `run_id`, and per-chart `content_angles`, `white_space`. Downstream consumers (content-engine, narrative, strategic reports, readiness, progress) keep reading the projection in this iteration, so nothing there breaks. The tables are the source of truth; the blob is a cache.

**Dangling evidence refs.** Evidence ids (`EvidenceItem.id`, 8 hex chars, from discovery commit `c637c98`) are stable only for a surviving competitor row; a deleted-then-rediscovered domain gets a new row and new ids. The projection builder resolves each `evidenceRefs` id against the current competitor's evidence; unresolved ids are dropped from the UI list, and if none resolve the point is shown as `estimated` with a "شاهدها دیگر در دسترس نیستند" note. Nothing is thrown, nothing is regenerated automatically.

**Staleness.** On read, compare the accepted-competitor set with `run.competitorSet`. Any difference sets `stale = true` (banner + still usable). Overrides whose competitor no longer exists are ignored, not deleted.

## 5. Pipeline

### 5.0 Trigger
Same pattern as discovery §5.0: the action checks ownership, calls `selectCompetitors`, refuses when `basis = NONE` or fewer than 2 competitors, refuses when a run is PENDING/RUNNING, creates `MatrixRun (PENDING)`, calls `triggerBackgroundRun('/api/matrices/run', { runId })`; that route owns `maxDuration = 300` and `after()`. On `{ ok: false }` the action marks the run `FAILED` immediately rather than leaving it `PENDING` until the stale reaper finds it, the pattern discovery settled on. The action returns the run id. UI polls. A run RUNNING for > 10 min is marked FAILED on next read.

### 5.1 Evidence bundle (deterministic)
Per company: `{ id, name, domain, type, positioning, keyFeatures, labels, discoveryConfidence, evidence: EvidenceItem[] (each with its stable id), keywordClusters?, keywordCount? }`. For the target: brandSummary offers, value proposition, audience, own keyword data if any; target evidence items get ids prefixed `own:`.

### 5.2 Axes (0–1 LLM call)
If `Workspace.matrixAxes` exists, skip. Otherwise propose 4 candidates (§3.2) and pause the run at stage `AXES` until the user picks; the UI shows the chooser. Default: the first 2 candidates are preselected so one click continues.

### 5.3 Score (one LLM call per chart, parallel, concurrency 3, JSON schema)
Input: the bundle, the axis definition with a scoring rubric for each end, the language. Output per company: `xScore`, `yScore`, `xReason`, `yReason`, `evidenceRefs`, `certainty` (`certain` | `likely` | `unsure`). Hard rules in the prompt and enforced in code:
- `certainty` is mapped in code to 0.9 / 0.7 / 0.5 (M9). The model never emits a raw number, and nothing it says can push a score to 1.
- Deterministic adjustments only, each scaled by the remaining headroom so a lower certainty never overtakes a higher one: the count of distinct evidence items supporting that axis, and agreement between the two core charts.
- A score with no `evidenceRefs` is kept but flagged `estimated = true` and its confidence is capped at 0.5.
- Scale: the judge already labelled ASPIRATIONAL competitors; the prompt states the target's scale explicitly so the target is never defaulted to 5.
- Confidence is shown with the shared bands (high ≥ 0.8, medium ≥ 0.6, otherwise low), as a word.
- Reasons are ≤ 200 chars, in `language`, and must not contain the words "estimated" or "inferred" when evidenceRefs is non-empty.

### 5.4 Target self-score
Same call, same rules. The target's evidence is the brand summary and own site. If the workspace has no brand summary the run refuses before starting.

### 5.5 White space (deterministic, unit-tested)
Split the 10×10 plane into 3×3 bands. For each band compute distance to the nearest non-target point. Candidate white-space cells are bands with distance ≥ 2 that are adjacent to (or contain) the target's band. Pick the one with the largest distance; tie-break toward the target. Store `{ xBand, yBand, nearestCompetitorDistance }`.

### 5.6 Summarise (1 LLM call per chart, or batched)
Given scores, overrides are **not** applied here (summaries describe the AI view; the UI marks overrides). Output: `marketPattern`, `opportunity` (must mention the computed white-space cell in words), `contentAngles` (≤ 3, each with `audienceSegment`). Then one cross-chart call: `crossChartSummary`, `strongestDifferentiation`, `targetAudienceSegment`.

### 5.7 Save
Transaction: charts + scores, run `DONE`, tokens recorded, projection rebuilt, activity log `MATRICES_GENERATED`. On any error: run `FAILED` with `error`, nothing else written, projection untouched.

### 5.8 Overrides
`setMatrixOverride(workspaceId, chartKey, competitorId | null, { xScore?, yScore?, note? })` upserts and rebuilds the projection immediately. `clearMatrixOverride` deletes one. Activity log `MATRIX_SCORE_OVERRIDDEN`.

## 6. UI (matrix section of the Growth workspace tab)

The competitors section above it belongs to the discovery spec (§6) and is not touched here.

1. **Header strip:** basis label ("بر پایهٔ رقیب‌های تأییدشده" / "بر پایهٔ رقیب‌های تأییدنشده"), competitor count, last run date, stale banner with a regenerate button, and the run button. During a run: stage names. Empty state says what is missing (competitors, brand memory) and links to fix it.
2. **Axes chooser** (appears at stage `AXES`, and behind a small "محورها" button later): 2 locked core chips, up to 3 market chips from the 4 candidates, each with its rationale; rename inline.
3. **Chart:** larger plot; four corner labels generated from the axis ends (e.g. "گسترده و عمومی"); the white-space cell hatched in saffron; target as the saffron point; points with `estimated` drawn hollow; overridden points carry a small pencil mark and a faint line to the AI position.
4. **Point drawer** (click a point): both reasons, evidence links (opens discovery evidence), confidence as a word, two steppers (x, y) that save on change with an undo toast, "بازگشت به امتیاز هوش مصنوعی". This replaces the bulk "fine-tune editor" table and the global Save button.
5. **Under the chart:** market pattern, opportunity, and **"از این نمودار چه محتوایی درمی‌آید"** with the content angles and their audience segment; each angle has "بفرست به ایده‌پردازی" (seeds an idea with that angle; wiring detail in implementation plan).
6. **Top summary card:** strongest differentiation + target audience segment + cross-chart summary.
7. **Technical disclosure** at the bottom: run id, model, tokens, basis. Collapsed by default.

Copy in `en` and `fa`; Persian written as Persian (see the Persian copy standard); all numbers through `useFormatter`.

## 7. Cost
Per run: 0–1 axes call + 3–5 score calls + 3–5 summary calls + 1 cross-chart call, small prompts (bundle ≤ ~6k tokens). Record `tokensUsed`. Measure on the same 5 workspaces as discovery §8 before rollout. Farjad will do the end-to-end cost pass himself after the solution is complete (same decision as discovery).

## 8. Downstream changes in this iteration
- `content-engine.ts` gate: require `charts.length ≥ 3` and `basis ≠ NONE`; pass `basis` into the ideation prompt so unconfirmed-competitor output is labelled.
- `report-readiness.ts`: `REQUIRED_MATRIX_CHARTS = 3`.
- `strategic-report-builder.ts`: read `cross_chart_summary` instead of the non-existent `insights.marketPatterns`.
- `gemini.ts` `summarizeMarketMetricContext`: include `content_angles` and `white_space`; stop reading `x_reason` of TARGET-less lists differently (no shape change otherwise).
- `narrative/engine.ts`: no change required; the projection keeps its shape.
- Delete `fallbackMatrices`, `heuristicPointScore`, `hashString`, and the `needTwoReviewedMatrices` path's "fallback to all non-rejected" behaviour.
- `saveWorkspaceCompetitiveMatricesEdits` (the manual-edit path) does not set `competitor_basis`, so a hand-edited payload loses the label saying what it rests on. The override layer (section 5.8) replaces this path; until it does, the basis must be carried through.
- **Outside the matrix files but the same defect, fixed with this work (M10):** `fallbackKeywordPayload` in `growth-keywords.ts` and `fallbackPayload` in `growth-offerings.ts`. Both fabricate a full payload when the model call fails. `growth-offerings.ts` is worse: `normalizePayload` builds a fallback unconditionally and uses it to fill any field the model omitted, so a partial answer is silently completed with invented offerings.

## 9. Error handling
Same stance as discovery §9: each stage fails loudly, a missing `OPENAI_API_KEY` is `FAILED` with an admin-facing message, and nothing invented is ever written. A partially failed set of chart calls fails the whole run (a matrix set with a missing core chart is not usable).

## 10. Testing
- **Unit:** white-space computation; projection builder (overrides applied, stale flag, ignored orphan overrides); evidence-ref enforcement (`estimated` + confidence cap); staleness comparison.
- **Integration:** recorded OpenAI fixtures for one fa and one en workspace; regenerate twice and assert overrides survive; failed score call leaves no rows and no projection change.
- **Live:** local app, one Persian and one English workspace, a human signs in (verification habit); confirm evidence links, override marker, stale banner, and that ideation is blocked until 3 charts exist.

## 11. Sequencing and conflicts
- Discovery implementation must land first: it provides `Competitor.evidence/positioning/keyFeatures/labels/confidence` (evidence items with stable ids), `selectCompetitors`, and `triggerBackgroundRun`. Its plan: `docs/superpowers/plans/2026-09-26-competitor-discovery.md`; the handover is after its Task 11.
- Both features live in `CompetitiveMatricesTab.tsx`. Discovery §6 restructures the competitors half; this spec rebuilds the matrix half. Implement sequentially on separate branches to avoid a merge fight.
- Checked 2026-09-27: discovery is at Task 9 of 11. `selectCompetitors` has landed (496429f, 7a035f8) and is already wired into `growth-matrices.ts`, `growth-keywords.ts` and `growth-offerings.ts`, with `competitor_basis` persisted. Two tasks remain there: its UI, then cleanup and a cost report.
- This spec now lives on branch `positioning-matrices`, cut from `main`, so it stops accumulating in the discovery branch's review range.

## 12. Deferred (tracked in Notion Mission Control)
- Richer evidence per competitor: pricing-page crawl, blog/post counts, traffic estimates (needs DataForSEO in prod, which is currently missing). Would let "Content presence" and a future "Audience scale" axis be computed rather than judged.
- Migrating downstream consumers from the projection blob to the tables.
- Per-chart history view (runs are stored, UI not planned yet).

## 13. Open for review
1. Confirm M1 (B + D) and M3 (fail closed even though it may block ideation for workspaces that relied on the fake fallback).
2. Confirm the two core axes in §3.1, or swap one.
3. Confirm minimum 3 charts (readiness threshold 5 → 3).
4. Confirm M8 (token panel becomes a disclosure).
5. Confirm M10: removing the keyword and offerings fallbacks is in scope here, which means those two features start failing visibly instead of quietly inventing output.
