# Model blind test: final post text

Decision (Farjad, 22 Nov 2026): compare Claude Sonnet 5.5, GPT-6.2 Sol, Gemini 4 Argon and Claude Opus 5.5
against today's content model (gemini-3.7-flash, which Google routes to 3.8 Flash) on the text a customer
would publish. Farjad judges blind: "would you publish this unchanged?". Persian is judged by Farjad only.

## What runs

Each post goes through the production content path with only the model changed (`pipeline.ts`):
`generateContentDraftWithGemini` (task `content_draft`) then `humanizeDraft` (task `humanize`) with the same
bounded expansion loop `generateDraftForItem` runs for autopilot. Same prompts, same functions.
The quality gate is left out: it does not change the text, it is a different (judge) model, and its
reject-and-regenerate loop would give each model a different number of drafts.

`route.ts` pins each call to one provider + model: one-entry chain, `modelOverride`, no event store,
no Sentry, no usage rows. Nothing is written to any database and nothing is sent anywhere but the model API.

## Files

| File | What | Cost |
|---|---|---|
| `config.ts` | candidates, brief selection, output paths | |
| `export.run.test.ts` | builds `data/briefs.json` (gitignored) from the **local** DB; refuses any other host | free |
| `blind.run.test.ts` | the run: every brief × model once, key + pack | **paid** |
| `harness.ts` | budget projection and cap, one retry after 429/5xx only, normalisation, tells | |
| `pack.ts` | seeded shuffle, key, Markdown + HTML pack, answer-sheet template | |
| `score.mjs` | unblinds Farjad's answers into the recommendation table | free |
| `harness.test.ts` | free tests (fake providers, real pipeline and runner) | free |

Outputs go to `.claude/agent-org/work/data/` (gitignored): `2026-11-22-model-blind-key.json` (the unblinding
key: model names, seed, tokens, cost, latency; do not open before scoring), `2026-11-22-model-blind-pack.md`
and `.html` (blind), `2026-11-22-model-blind-scores.json` (answer sheet).

## Commands (from `apps/web`)

```bash
set -a; source /Users/farjad/Downloads/Work-Studio/Contivo/apps/web/.env.local; set +a

# free tests
pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts harness

# 1. briefs (free, local DB)
BLIND_EXPORT=1 pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts export.run

# 2. the run (paid; stops before any call if the projection is over BLIND_TEST_MAX_USD, default 10)
BLIND_TEST_RUN=1 pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts blind.run

# 2b. fill empty slots later (e.g. once ANTHROPIC_API_KEY is in .env.local); same seed, earlier results kept
BLIND_TEST_RUN=1 BLIND_TEST_ONLY=claude-sonnet-5-5,claude-opus-5-5 \
  pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts blind.run

# 3. after Farjad has answered every post (HTML button or the JSON file)
node scripts/model-blind-test/score.mjs \
  --key    ../../.claude/agent-org/work/data/2026-11-22-model-blind-key.json \
  --scores ../../.claude/agent-org/work/data/2026-11-22-model-blind-scores.json \
  --out    ../../.claude/agent-org/work/data/2026-11-22-model-blind-results.md
```

The pack is written only when every brief has every model's post (or with `BLIND_PACK_ALLOW_PARTIAL=1`).
A provider whose key is missing is recorded as `not_run` and never called.

## Briefs

5 English briefs from real local workspaces (`config.ts`), including one fabrication-bait topic and one
storyline-bound brief. **No Persian briefs yet:** the local DB has no real Persian workspace (only example.com
test data). Real Persian briefs need a read-only production query that Farjad must approve first; add the
ids to `BRIEF_SELECTION.FA` and re-run the export. The stored idea angle is not kept after drafting, so the
writer gets no extra context (stated in each brief).
