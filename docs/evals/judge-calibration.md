# Judge calibration eval

Owner: contivo-llm-engineer (Data & AI). Spec: `docs/superpowers/specs/2026-11-22-ai-provider-failover-design.md`,
§"Judge / quality-gate consistency".

A judge that changes provider changes its verdicts. This eval replays the autopilot quality gate's AI
judge on one forced provider and measures how often it agrees with drafts that were already judged.
A provider goes in the `quality_gate` chain only if it clears the pass bar.

Code: `apps/web/scripts/eval-judge/`.

| File | What |
|---|---|
| `export-dataset.mjs` | Builds `dataset.json` from the **local** DB (refuses any non-localhost host). Needs `psql`. |
| `synthetic.json` | 5 hand-written adversarial drafts, `synthetic: true`. |
| `dataset.json` | The eval set (generated locally; gitignored, see below). |
| `judge.ts` | Gate prompt (imported from `quality-gate.ts`), parse, and decision (same as `evaluateDraft`). |
| `transport.ts` | `layerTransport(provider)`: `runAiTask` forced onto one provider; `fixtureTransport` for tests. |
| `metrics.ts` | Agreement, Wilson 95 % CI, per-criterion disagreement, cost, pass bar. |
| `run.ts` | `runEval`, `formatReport`, `writeReport` (to `results/`, gitignored). |
| `eval.run.test.ts` | **Paid** entry point, skipped unless `EVAL_PROVIDER` is set. |
| `eval-judge.test.ts` | Free tests (16), no network. |

## Dataset (built 21 Nov 2026 from the local DB)

The local DB has fewer than the 20 drafts the spec asks for. Census from `autopilot_runs.log`:

| | count |
|---|---|
| Gate events logged | 23 (22 approved, 1 rejected) |
| Approvals with a judge recorded | 19 (17 OpenAI, 2 Gemini) |
| Rejections by the AI judge | **0** (the only rejection was the deterministic `word_count` check; the judge never saw it) |
| Judged, but the draft row has since been deleted | 14 (including both Gemini-judged drafts) |
| **Usable real gate verdicts** | **5, all approved, all judged by OpenAI** |

What is in `dataset.json` (11 items):

| Items | Source | Label |
|---|---|---|
| 5 | real gate verdicts (`local_db_gate_verdict`) | approve, with the stored scores (9/9/10) |
| 1 | `cmoiy4ctk000jvadeao2li0s8`, a real blog draft from the manual path (April) that invents an "Acme Services" case study (15 people, 30+ hours a week, 80 % automated) | reject. Not a gate verdict: the label applies the current `factual_safety` rule. `labelSource: gate_prompt_rule` |
| 4 | synthetic fabrications: first-person client churn story (mirrors the August prod incident), invented named study with percentages, a client result buried in an otherwise sound post, and a Persian first-person client story | reject, `failingCriterion: factual_safety` |
| 1 | synthetic control: a hypothetical clearly framed as one ("Picture a six-person team...") | approve. A judge that rejects it is over-rejecting |

The August "churn dropped" post that the old judge scored 9/10 is **not** in the local DB. It exists
only in production, if anywhere.

Caveats on the reference labels, all recorded per item:

- **Prompt drift.** By commit time, all 5 real verdicts came before `0d5e20c`, the commit that added the
  fabricated-case-study rule. Three of them (348, 349 and 346 words, judged at 05:46–05:48 UTC on 18 Aug, one to
  three minutes before the commit) match that commit's message ("three regenerated posts at 346-349 words"), so
  they were most likely judged by the new prompt from the uncommitted tree. The other two were judged by
  the older prompt.
- **Model unknown.** The run log stores the provider only. `gpt-4.1` (the `OPENAI_DEFAULT_MODEL` default) is
  assumed, and recorded as `judgeModelAssumed`, not as a fact.
- **Brand summary** is the workspace's current one, not necessarily the one the judge saw.
- Rows were last updated at publish time, with no later edits, so the text should be the text that was judged.
  This is a heuristic.
- `cmsy7kt3t…` is 74 words. Today's deterministic word-count check would reject it before the judge ever saw it.
  The eval replays the AI step only, so it stays in.

**What this set can and cannot tell you.** Real verdicts are all "approve" and all rejects are fabrications,
so the eval measures two things: does the provider keep approving clean posts, and does it catch invented
proof? It says nothing about brand-fit or clarity rejections, and nothing about how Gemini compares with
the old Gemini judge. Read the `realOnly` agreement separately from the total.

## Running it (Farjad)

Every provider call costs money. Nothing runs without `EVAL_PROVIDER`.

Prerequisites, none verified yet: cto's `apps/web/src/lib/ai/run.ts` exists and exports `runAiTask`;
`quality-gate.ts` exports `buildJudgePrompt` (see below); provider keys in the env; Prisma client generated,
because the layer reads the Gemini/OpenAI model from app settings.

```bash
cd apps/web
set -a; source <main checkout>/apps/web/.env.local; set +a
# plus ANTHROPIC_API_KEY for the Claude run
EVAL_PROVIDER=openai    EVAL_REPEATS=3 pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
EVAL_PROVIDER=anthropic EVAL_REPEATS=3 pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
EVAL_PROVIDER=gemini    EVAL_REPEATS=3 pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
```

Run OpenAI first. It is the reference judge on the new transport, so it shows how much of any
disagreement comes from prompt drift and how much from changing provider. `EVAL_ONLY=id1,id2` runs a subset.
`EVAL_MODEL=<id>` pins the forced provider's model (layer `modelOverride`), for a before/after on one provider:

```bash
EVAL_PROVIDER=openai EVAL_MODEL=gpt-4.1       EVAL_REPEATS=1 pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
EVAL_PROVIDER=openai EVAL_MODEL=gpt-6.2-astra EVAL_REPEATS=1 pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
```

Since 22 Nov the OpenAI side of `quality_gate` resolves to `OPENAI_MODEL_JUDGE` (default `gpt-6.2-astra`), so an
unpinned `EVAL_PROVIDER=openai` run measures Astra, not gpt-4.1.
A red test means the provider missed the bar. The JSON report goes to `scripts/eval-judge/results/`.

Free tests:

```bash
pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval-judge
```

Rebuild the dataset (local DB only):

```bash
node scripts/eval-judge/export-dataset.mjs --env-file <main checkout>/apps/web/.env.local
```

Estimated cost per repeat (11 calls, about 16k input tokens total, which is chars/4 of the built prompts): OpenAI gpt-4.1 about $0.05,
Claude Opus 5.5 at `effort: low` about $0.10–0.20 (thinking tokens are billed as output and are the
uncertain part), Gemini Flash less than either. Three providers × 3 repeats should come to under $1. The run reports the real figure
from `estimateCostUsd`. It prints "unknown" rather than $0 for any model missing from `ai-usage.ts` `PRICES`,
which today includes the Claude models.

## Pass bar

A provider may judge if, over every call (items × repeats):

1. agreement with the reference verdict is **≥ 85 %**, where a failed, timed-out, unparseable or wrong-provider call
   counts as a disagreement, and
2. it approves **zero fabrications**, synthetic or the real known one, on **any** repeat.

Rule 2 is stricter than the brief, which named synthetic fabrications only. Approving the real "Acme Services"
draft is the exact failure this eval exists to catch, so it counts too.

Uncertainty: with 11 items, one miss gives 90.9 % (pass) and two give 81.8 % (fail). At 10/11 the Wilson 95 % interval is
roughly 62–98 %. The bar separates a broken judge from a working one. It cannot rank two good ones. Use
`EVAL_REPEATS=3` so that flip-flopping items show up (`flippedItems`).

Also reported: per-criterion pass/fail disagreement against the stored scores, mean |Δscore|, how many
expected `factual_safety` failures were caught by `factual_safety` rather than by a veto, approve-labelled
drafts that were rejected, tokens, cost and p50 latency.

## Needed from contivo-cto (not edited here: their files)

1. **Required, one line.** `apps/web/src/lib/autopilot/quality-gate.ts`: change `function buildJudgePrompt(` to
   `export function buildJudgePrompt(`. Until then the paid run stops before any call, with that message.
   (Verified: `EVAL_PROVIDER=anthropic` currently fails with `MissingGateExportError`, and no request is made.)
2. Optional: hoist the system string in `runJudge` to `export const JUDGE_SYSTEM_PROMPT = '...'`. Until then
   the eval uses a copy (`GATE_SYSTEM_PROMPT_COPY`) and says so in the report.
3. Forcing a provider uses the layer's existing override `AI_CHAIN_QUALITY_GATE=<provider>`, scoped to each
   call. No new option is needed. The transport expects `runAiTask(task, AiRequest)` from `@/lib/ai/run`,
   returning `AiResult`. If the path or name differs, change `LAYER_MODULE` in `transport.ts`.
4. Behaviour changes that the eval will see and that are not about the provider:
   - Today `lib/gemini.ts` `requestJsonFromAi` **does not send the system prompt to Gemini** (`callGemini` takes no
     system argument), so the "strict brand editor" instruction reaches OpenAI only. The new Gemini adapter sends
     `systemInstruction`. Gemini-as-gate changes even if the chain does not.
   - The gate asks for `json_object`, not a schema. `providers/anthropic.ts` sets `output_config.format` only
     for `json_schema`, so Claude judges with no format constraint, and any prose around the JSON becomes
     `invalid_output`. A `GATE_SCHEMA` would fix that, but it is a prompt change: eval before and after.
   - Claude runs at `effort: 'low'` with `fallbacks: 'default'`. A refusal can be answered by another Claude
     model, so the layer must report the model that actually answered; the eval records `result.model`.

## Structured-output parity

What Claude structured outputs (`output_config.format`) and Gemini `responseSchema` do not support, per schema.
Sources: Claude, platform.claude.com/docs/en/build-with-claude/structured-outputs (read 21 Nov 2026): no
`minimum`/`maximum`/`multipleOf`, no `minLength`/`maxLength`, `minItems` only 0 or 1, no other array
constraints, `additionalProperties` must be `false`, `$ref`/`$defs` fine, no recursion, enum casing not
guaranteed, at most 24 optional parameters and 16 union-typed ones per request. Gemini: the API reference
`Schema` object (an OpenAPI 3.0 subset) has no `additionalProperties`, `enum` is for STRING only, and
`minItems`/`maxItems`/`minimum`/`maximum`/`propertyOrdering`/`anyOf`/`nullable` exist. cto has a recorded 400 for
`additionalProperties` (`src/lib/ai/__fixtures__/gemini-400-additional-properties.json`).

Every schema below marks all properties `required` and uses no unions or `$ref`, so the Claude complexity
limits and the `$ref` question do not apply anywhere.

| Schema | Feature used | Claude | Gemini `responseSchema` | Consequence / action |
|---|---|---|---|---|
| `JUDGE_SCHEMA` (`competitors/judge.ts`) | `additionalProperties: false` (2 levels) | OK, required | **Unsupported**: 400. `toGeminiSchema` drops it | Gemini can return extra keys; the layer's validator catches them against the original schema |
| | string `enum` (`labels[]`, `type`, `certainty`) | OK, but **casing not guaranteed** | OK | `ai/output.ts` enum check is case-sensitive (`option === value`), so `"Direct"` becomes `invalid_output`, then a retry, then failover. **Compare case-insensitively or normalise before validating** |
| | length limits (name 120, reason 600, `keyFeatures` ≤ 8) | description only, enforced by `capJudgeText` | same | none |
| | property order (decision fields before `reason`) | kept as written (all required) | order not guaranteed without `propertyOrdering` (unverified today) | suggest `toGeminiSchema` emit `propertyOrdering = Object.keys(properties)` |
| `AXIS_SCHEMA` (`matrices/propose-axes.ts`) | `minItems: 4`, `maxItems: 4` | **Unsupported** (only `minItems` 0/1). `transformJSONSchema` strips them into the description | OK | Claude may return 3 or 5. The layer validator rejects that as `invalid_output` although `normaliseMarketAxes` copes with it, so the call is retried or fails over for no gain. **Do not hard-fail on array counts the call site already normalises** |
| | `additionalProperties: false` (3 levels, incl. the shared `END` object) | OK | dropped | as above |
| `SCORE_SCHEMA` (`matrices/score-chart.ts`) | `integer` with `minimum: 1`, `maximum: 10` | **Unsupported**: stripped | OK | out-of-range score: layer `invalid_output` (and `validScore` rejects it as well). Correct, but costs a retry |
| | string `enum` `certainty` | casing caveat | OK | `normalizeCertainty` already lower-cases; the layer validator does not (see above) |
| | `additionalProperties: false` | OK | dropped | as above |
| `CHART_SUMMARY_SCHEMA` (`matrices/summarise.ts`) | `maxItems: 3` on `content_angles` | **Unsupported**: stripped | OK | 4 angles become `invalid_output` although the call site does `.slice(0, MAX_ANGLES)`. Same fix as `AXIS_SCHEMA` |
| | `additionalProperties: false` (2 levels) | OK | dropped | as above |
| `CROSS_CHART_SCHEMA` (`matrices/summarise.ts`) | 3 required strings, `additionalProperties: false` | OK | dropped | none |
| Quality gate (`autopilot/quality-gate.ts`) | **no schema** (`json_object`) | no constraint sent | `responseMimeType: application/json` only | parity is a prompt question, not a schema one (see "Needed from contivo-cto" 4) |

Not used anywhere, so no action: number enums (Gemini STRING-only), `$ref`, unions, `pattern`, `format`.

Side note for the head of data, not this eval: `SCORE_SCHEMA` has the model place each company on the chart
(`x_score`/`y_score`), with evidence refs. That is the current matrices design, but it is model-placed data
points, which the generated-documents rule forbids for reports. It is worth deciding on explicitly when the
matrices redesign resumes.


## Data handling

`dataset.json` is **not committed**: it holds real drafts and brand summaries from the local database and this repo is public. Rebuild it locally with `export-dataset.mjs`. Production drafts are not used (Farjad, 22 Nov).
