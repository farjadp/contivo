# AI provider failover — OpenAI → Claude → Gemini

Status: **draft, waiting for Farjad's go** · Owner: contivo-head-of-data · Branch: `myca/ai-failover-aba0e1`

## Why

22 Nov 2026, 01:12 UTC: the OpenAI org behind `OPENAI_API_KEY` ran out of credit. OpenAI
returned `429 insufficient_quota`. Discovery, matrices and the autopilot quality gate call
OpenAI directly with no fallback, so every AI feature on production was dead. The customer
read "too many requests, wait a few minutes", and nobody was alerted
(`.claude/agent-org/work/engineering/2026-11-22-e2e-handover.md`, B3/B4).

Farjad: "if one of them stops working for any reason, it quickly switches to the next two."

The hard constraint comes from our worst incident: a retired Gemini model fell back to OpenAI
**silently for months**. So failover must be **fast and loud**: every switch is logged,
alerted and visible in admin. Never silent.

## 1. Inventory (main @ 3c793cf)

All AI calls live in `apps/web`. `apps/api` makes none (it has `OPENAI_API_KEY` set but unused).

| # | Call site | Feature (`ai_usage_logs.feature`) | Provider today | Model | Needs | Fallback today |
|---|---|---|---|---|---|---|
| 1 | `lib/competitors/search.ts` `runOneQuery` | `competitor_web_search` | OpenAI Responses | `OPENAI_SEARCH_MODEL` / gpt-5-mini | **web search** with source URLs, country hint | none → run FAILED |
| 2 | `lib/competitors/queries.ts` | competitor queries | OpenAI chat | `OPENAI_DEFAULT_MODEL` / gpt-4.1 | JSON object | none |
| 3 | `lib/competitors/judge.ts` `runOneBatch` | `competitor_judge` | OpenAI chat | gpt-4.1 | **strict JSON schema** | none → `JUDGE_UNAVAILABLE` |
| 4 | `lib/matrices/openai.ts` `callStructured` (propose-axes, score-chart, summarise) | matrices | OpenAI chat | gpt-4.1 | **strict JSON schema** | none → `MatrixAiError` |
| 5 | `lib/report/narrative.ts` | report narrative | Gemini → OpenAI | `GEMINI_MODEL` / gemini-2.5-pro, gpt-4.1 | JSON | → `EMPTY_NARRATIVE` (honest) |
| 6 | `app/actions/growth-brand-assets.ts` | brand assets | OpenAI chat | gpt-4.1 | JSON object | none |
| 7 | `app/actions/growth-keywords.ts` | keywords | OpenAI chat | gpt-4.1 | JSON object | none |
| 8 | `app/actions/growth-offerings.ts` | offerings | OpenAI chat | gpt-4.1 | JSON object | none |
| 9 | `lib/gemini.ts` `callGemini`/`callOpenAi` — used by `analyzeWebsiteWithGemini`, content ideas, `generateContentDraftWithGemini`, `generateInstantDraft`, legacy competitors, positioning, SERP analysis | website_analysis, content_ideas, content_draft, instant_draft, … | **Gemini → OpenAI** | admin `gemini-3.7-flash`, admin `gpt-4.1` | JSON object or prose | **heuristic placeholder text** for drafts, positioning, website analysis |
| 10 | `lib/gemini.ts` `requestJsonFromAi` — used by `autopilot/quality-gate.ts` (judge), `humanize.ts`, `narrative/engine.ts` (storylines), `content-image.ts` (image prompt), `actions/guide.ts` | request_json | Gemini → OpenAI | as 9 | JSON | null (caller decides) |
| 11 | `lib/content-image.ts` | images | OpenAI images | gpt-image-1 | **image generation** | none |
| 12 | `lib/competitors/run-errors.ts` | — | — | — | maps **every** 429 to "wait a few minutes" | B3 |

Two extra findings that matter for the design:

- **Silent fabrication already exists.** When both providers fail, #9 returns
  `fallbackDraft(...)` / `fallbackPositioning(...)` / a heuristic brand extraction: template text
  that looks like real output. That is the "silent fallback" pattern again, at the content level.
- `gemini-2.5-pro` (#5 default) is deprecated; from 1 Dec 2026 Google routes it to
  gemini-3.8-flash. Not a blocker, but #5's model should come from the same config as #9.

### Can Claude and Gemini do the same job?

| Capability | OpenAI | Claude | Gemini |
|---|---|---|---|
| Prose / JSON object | yes | yes | yes (`responseMimeType`) |
| Strict JSON schema | `json_schema strict` | `output_config.format` json_schema (structured outputs) | `responseSchema` (OpenAPI subset — no `additionalProperties`, looser) |
| Web search with source URLs | `web_search` tool, works for Persian (verified Sep) | server tool `web_search_20260209`, returns result URLs + citations | Google Search grounding; **hit 429 in prod**; URLs come as redirect links in grounding metadata |
| Image generation | gpt-image-1 | **no** | Imagen / gemini image models (separate API, not wired) |

So: text and JSON tasks get all three. Web search gets OpenAI → Claude, with Gemini last and
unproven. Images stay OpenAI-only in this change (failure there degrades to "no image", which is
already honest); an Imagen fallback is a follow-up.

## 2. Design

### One provider layer: `apps/web/src/lib/ai/`

```
ai/
  types.ts        AiTask, AiRequest, AiResult, ProviderId, AiErrorClass
  errors.ts       classify(provider, status, body, thrown) → AiErrorClass
  health.ts       per-provider health: cooldown-until, reason, last error (in-process + DB-backed read)
  chains.ts       ordered provider chain per task, overridable by env
  providers/
    openai.ts     chat, responses+web_search
    anthropic.ts  @anthropic-ai/sdk messages (+ web_search_20260209)
    gemini.ts     generateContent (+ googleSearch grounding)
  run.ts          runAiTask(task, request): walk the chain, classify, mark, log, alert
  alert.ts        Sentry event + ai_provider_events row
```

Every call site in the inventory stops calling `fetch(api.openai.com…)` itself and calls
`runAiTask`. Prompts, schemas and parsing stay where they are; only transport moves.
`recordAiUsage` keeps its signature (provider is already a column).

A request says what it needs, so the layer can skip providers that cannot do it:

```ts
runAiTask('competitor_judge', {
  system, prompt,
  output: { kind: 'json_schema', name: 'competitor_judgments', schema: JUDGE_SCHEMA },
  timeoutMs: 90_000,
});
// → { ok: true, provider: 'anthropic', model, text, json, usage, failedOver: [{provider:'openai', class:'billing'}] }
// → { ok: false, kind: 'all_unavailable', attempts: [...] }
```

### Chains (default)

| Task | Chain | Why |
|---|---|---|
| `competitor_web_search` | OpenAI → Claude → Gemini | OpenAI proven for Persian; Claude web search is solid; Gemini grounding 429s |
| `competitor_judge`, matrices (`matrix_*`) | OpenAI → Claude → Gemini | strict schema; Gemini's schema support is weakest |
| `competitor_queries`, brand assets, keywords, offerings | OpenAI → Claude → Gemini | default |
| content ideas, drafts, instant draft, website analysis, positioning, SERP | **Gemini → OpenAI → Claude** | keeps today's order (cheapest first, already in prod); Claude added third |
| `quality_gate` (autopilot judge), humanize, storylines, guide, image prompt | Gemini → OpenAI → Claude | same, see §5 for the judge |
| report narrative | Gemini → OpenAI → Claude | same |
| images | OpenAI only | nobody else is wired |

Override per task without a deploy of code: `AI_CHAIN_<TASK>=anthropic,openai` (env), and a
global kill switch `AI_PROVIDER_DISABLED=gemini`. A provider with no key is skipped and logged once
at boot as "not configured" — never treated as a failure.

### Models

| Provider | Default | Env | Notes |
|---|---|---|---|
| OpenAI | gpt-4.1 / gpt-5-mini (search) | existing `OPENAI_DEFAULT_MODEL`, `OPENAI_SEARCH_MODEL` | unchanged |
| Claude | `claude-opus-5-5` ($4 in / $20 out per 1M) | `ANTHROPIC_MODEL` | current Opus from the `claude-api` skill (cached 2026-11-03). `claude-sonnet-5-5` ($2/$10) is the cheaper option — **Farjad's call**, see Decisions |
| Gemini | admin setting (`gemini-3.7-flash`) | existing | narrative.ts moves onto the same setting |

Claude call shape (from the skill, not memory): official `@anthropic-ai/sdk`, `messages.create`,
no `temperature` (Opus 5.5 rejects sampling params), adaptive thinking is always on so set
`output_config.effort: 'low'` for these single-shot tasks, structured outputs via
`output_config.format`, `max_tokens` 16000, SDK `maxRetries: 0` (our layer owns retries) and a
per-request `timeout`. Server-side refusal fallback (`fallbacks: "default"`) is on, so a safety
decline is re-run inside the same call instead of failing over.

### Error classification

| Class | Detected by | Action | Health |
|---|---|---|---|
| `billing` | OpenAI 429 `insufficient_quota`; Anthropic 400/402 "credit balance is too low" / `billing_error`; Gemini 429 `RESOURCE_EXHAUSTED` with billing/quota-exceeded (daily/plan), 403 billing disabled | fail over **now**, alert **critical** | unhealthy 15 min |
| `auth` | 401, 403 (non-billing), "invalid api key", key missing at runtime | fail over now, alert critical | unhealthy 15 min |
| `model_gone` | 404 model not found | fail over now, alert critical | unhealthy 15 min |
| `rate_limit` | 429 `rate_limit_exceeded` / Anthropic `rate_limit_error` / Gemini per-minute 429 | one retry after `min(retry-after, 2 s)`, then fail over, alert warning | cool-down = retry-after (cap 60 s) |
| `overloaded` / `server` | 5xx, Anthropic 529 | fail over, warning | 30 s cool-down after 3 in a row |
| `timeout` / `network` | AbortSignal timeout, fetch threw | fail over, warning | 30 s after 3 in a row |
| `bad_request` | 400 (non-billing), schema rejected | **no** failover — our bug; error to caller, alert error | none |
| `invalid_output` | 200 but empty / unparseable / fails schema | try the **same** provider once more, then fail over (another model may comply) | none |
| `refusal` | Claude `stop_reason: refusal` after server fallback; OpenAI refusal field | no failover (content problem) | none |

Unhealthy providers are skipped until the cool-down ends; the first call after it is the probe.
Health is per Node process (contivo-web runs one), and each transition is written to the DB, so
admin sees the same state and a restart does not forget a billing failure: on boot the layer reads
the last `billing`/`auth` event younger than 15 min.

"Fast": a billing or auth failure costs one round trip (~300 ms) once, then zero for 15 minutes.

### Loud, never silent

Every attempt already writes `ai_usage_logs` on success. Add:

1. **`ai_provider_events`** (new table, additive migration — goes through contivo-database-engineer
   via contivo-cto): `id, createdAt, provider, task, errorClass, status, message (sanitised, 500 chars),
   failedOverTo (nullable), workspaceId, userId`. One row per failed attempt and per health change.
2. `ai_usage_logs` row of a request that failed over carries `feature = '<task>'` and the answering
   provider; the failed attempts are in `ai_provider_events`. (No schema change to `ai_usage_logs`.)
3. **Sentry**: `captureMessage` with tags `ai.provider`, `ai.task`, `ai.error_class`, level
   `fatal` for billing/auth/model_gone, `warning` for the rest, fingerprint
   `[provider, errorClass]` so one outage is one Sentry issue, not 10,000. All three providers down →
   `fatal` "AI fully unavailable".
4. **Admin**: a "AI providers" card on the admin console: per provider configured / healthy /
   cooling down until, last error class and time, and the last 24 h of failovers per task.
5. **Logs**: one `console.error('[ai] openai billing → anthropic for competitor_judge')` line per switch.

### The heuristic fallbacks in `lib/gemini.ts`

When the whole chain fails, `generateContentDraftWithGemini`, `generatePositioningInsights` and
`analyzeWebsiteWithGemini` today return template text. Change: return `null` /
throw `AiUnavailableError`, and the callers show the unavailable message. (`generateInstantDraft`
already does this.) This touches `content-engine.ts` call handling — small, listed in the file scope.

### Customer-facing message

`run-errors.ts`: add `AI_UNAVAILABLE` (written when the chain ends `all_unavailable`, or when the
first error class was billing/auth). New kind `aiUnavailable`; `rateLimited` is shown only when every
attempt was a genuine rate limit.

- en: "The AI service is unavailable right now. We've been alerted and are fixing it. Your work is saved."
- fa (native, via `persian-writing`): «سرویس هوش مصنوعی الان در دسترس نیست. به ما خبر داده شده و در حال رفعش هستیم. کارهای شما ذخیره شده است.»

Never "wait a few minutes" for billing or auth.

### Timeouts

Per attempt, not per chain: web search 150 s (existing), judge 90 s (existing), JSON/prose 60 s,
long drafts 120 s. Whole-chain budget = sum, but a billing/auth failure returns in under 1 s, so the
realistic worst case is one slow provider + one answer.

### Cost per task per provider (list prices, USD / 1M tokens in/out)

| Provider/model | in | out | web search |
|---|---|---|---|
| OpenAI gpt-4.1 | 2.00 | 8.00 | — |
| OpenAI gpt-5-mini | 0.25 | 2.00 | $10 / 1k calls |
| Claude Opus 5.5 | 4.00 | 20.00 | $10 / 1k searches (to confirm on pricing page before merge) |
| Claude Sonnet 5.5 | 2.00 | 10.00 | same |
| Gemini 3.8 flash | 0.75 | 3.75 | grounding priced per prompt (to confirm) |

Measured run (22 Nov, OpenAI): one discovery = 224k tokens, $0.53. The same run on Claude Opus 5.5
would be roughly 2–2.5× (≈$1.10–1.30), on Sonnet 5.5 ≈ same as OpenAI. Failover is the exception
path, so the expected monthly delta is small; the admin card shows real cost by provider from
`ai_usage_logs`. Prices go into `ai-usage.ts` `PRICES` only after reading them off the provider page
(that file's rule).

### Judge / quality-gate consistency

A judge that changes model changes its scores. Rules:

1. Every judged result stores `judgeProvider` + `judgeModel` (the autopilot quality gate already
   returns `provider`; competitor judgments get it in `sourceStats`). Runs are comparable only within
   one judge model; admin shows the mix.
2. The gate's pass threshold stays one number, but the prompt asks for **evidence-cited pass/fail per
   criterion**, not a free 1–10; booleans move far less across models than scores do.
3. Calibration set: 20 drafts already judged in prod (10 passed, 10 rejected, incl. the fabricated
   case study the old judge gave 9/10). CI-optional eval runs them on each provider; a provider is
   allowed in the judge chain only if it agrees with the reference labels ≥ 85 %. Until the set is
   built, Claude and Gemini are allowed in the gate chain but every gate decision they make is marked
   `needsReview` and never auto-publishes. **Fail closed**: no judge available → draft waits, never
   publishes unjudged.

### Pre-flight (B4)

Before spending money on 8 queries + 6 searches, discovery checks that the judge chain has at least
one healthy provider (health state, no network call). If none: fail fast with `AI_UNAVAILABLE`.

### Tests

Unit, no network: `errors.test.ts` (each class × each provider, real recorded bodies),
`run.test.ts` (chain walk: billing → next immediately and marked unhealthy; rate limit → one retry
then next; 5xx/timeout → next; bad_request → no failover; invalid_output → same provider once;
all down → `all_unavailable` + fatal alert; cool-down skip and probe), provider adapters against
recorded fixtures (OpenAI chat/responses, Anthropic messages + web search, Gemini + grounding),
`run-errors.test.ts` for the new message. Existing judge/matrix/search tests keep passing.

### Local verification

`.env.local` has OpenAI + Gemini keys, **no Anthropic key**. Plan: force OpenAI to fail with
`AI_FORCE_FAIL=openai:billing` (dev-only, ignored when `NODE_ENV=production`), run a real discovery
and a content draft, show `ai_provider_events` + `ai_usage_logs` rows and the Sentry event. The
Claude hop is proven with recorded fixtures until Farjad's key exists; then the same run repeats
with `AI_FORCE_FAIL=openai:billing,gemini:billing` for Claude live.

## File scope

New: `apps/web/src/lib/ai/**`, migration `apps/api/prisma/migrations/2026112200…_ai_provider_events`
+ model in `schema.prisma` (additive), admin card component.
Edited: the 12 call sites above (transport only), `lib/competitors/run-errors.ts` + its consumer,
`lib/competitors/pipeline.ts` (pre-flight), `lib/admin-console.ts`, `lib/ai-usage.ts` (`AiProvider`
type + verified prices), `messages/{en,fa,it}/growth.json` (`aiUnavailable` key only),
`apps/web/package.json` (`@anthropic-ai/sdk`), `.env.example`.
Not touched: social publish code (`apps/api/src/modules/social/**`, channels branch), `lib/site-api/**`.

## Env vars (contivo-web only)

`ANTHROPIC_API_KEY` (new, required for the Claude hop), `ANTHROPIC_MODEL` (optional), existing
`OPENAI_API_KEY`, `GEMINI_API_KEY`, optional `AI_CHAIN_<TASK>`, `AI_PROVIDER_DISABLED`.

## Decisions for Farjad

1. Claude model for failover: **Opus 5.5** (best quality, ~2× OpenAI cost on the exception path) or
   **Sonnet 5.5** (≈ OpenAI cost). Recommendation: Opus 5.5 for judge/matrices, Sonnet 5.5 is fine
   everywhere else — but it is your call.
2. Content chain stays Gemini-first (cheapest, as today), or OpenAI-first like the rest.
3. Until the judge calibration set exists: Claude/Gemini-judged autopilot drafts wait for your review
   (recommended) or auto-publish.
