# No fabricated fallbacks in Keywords and Offerings

Date: 2026-09-29. Decisions: Farjad chose 1A, 2A and 4 in session on this date.
Scope: `apps/web/src/app/actions/growth-keywords.ts`, `growth-offerings.ts`, the Keywords tab, and a one-off cleanup script. **Matrices is out of scope** — its fallback belongs to the positioning-matrices spec.

## Why

The pilot customer buys strategy plus content built from competitor research. Both analyses invent output when the AI call fails, save it as a success, and overwrite whatever real result was there:

| Source | What it invents | Who reads it |
| --- | --- | --- |
| `fallbackKeywordPayload` (AI call failed or unparseable) | keywords sliced from page text, a fixed 55/20/15/10 intent split, a canned content gap "Strategic content planning for teams" | content engine, narrative engine, report readiness, progress score |
| `normalizePayloadFromAi` (AI skipped a competitor) and `normalizeIntentDistribution` (split missing) | the same 55/20/15/10 split, rendered as a chart | Keywords tab, same consumers |
| `fallbackPayload` in offerings (AI call failed) | an empty result saved as success, then a **comparison prompt run on that empty input**, which yields "white space" advice from nothing | report, progress score |

## Decisions

**D1 (1A) — an AI failure writes nothing.** When the model call fails, returns no content, or returns JSON that cannot be parsed, the action returns an error and does not touch `audienceInsights`. The previous result stays exactly as it was. The existing generate button is the retry.

- Keywords also treats a parsed result in which **no competitor has a single primary or secondary keyword** as a failure: it would otherwise pass the content engine's `competitors.length > 0` gate while carrying nothing.
- Offerings: an extraction failure stops before the comparison prompt. A comparison failure after a good extraction is not a failure — the comparison stays empty, which is honest.
- Offerings skips the comparison prompt when the extraction found no offerings for the client or any competitor. Nothing to compare means no prompt and no spend.
- New error keys say what happened and that nothing was lost: `keywordsAiFailed`, `offeringsAiFailed` (en and fa).
- Tokens spent on a failed call are recorded in the activity log (`COMPETITOR_KEYWORDS_FAILED`, `PRODUCTS_SERVICES_INTEL_FAILED`), since there is no saved payload to carry them.

**D2 (2A) — a missing intent split is `null`, not a guess.** `IntentDistribution` becomes nullable. `normalizeIntentDistribution` returns `null` when the model gave no usable numbers; a competitor the model skipped keeps its row with `intent_distribution: null` and its existing "insufficient evidence" texts. The Keywords tab shows "not enough evidence" in place of the four numbers. Stored results with numbers render as before.

**D3 — delete the fabricating code.** `fallbackKeywordPayload` and offerings' `fallbackPayload` are removed; `normalizePayload` builds its own empty defaults.

**D4 (4) — clean up what is already stored.** A detector recognises results only the old fallbacks could have produced:

- Keywords: some competitor has a cluster named `Estimated Theme` **and** the note `score estimated from limited evidence`.
- Offerings: the client has no offerings, its summary says `Insufficient public evidence`, and no competitor has an offering. Such a result is useless whether a fallback or a genuinely empty run made it, and report readiness already treats it as not ready.

A script (`apps/web/scripts/remove-fabricated-intel.ts`) runs the detector over every workspace. It is a **dry run by default**: it prints the affected workspace ids and which result it would remove. With `--apply` it removes only those keys from `audienceInsights` and leaves everything else. Farjad runs the dry run, reviews the count, then decides on `--apply`. The customer re-runs the analysis afterwards.

## Tests

Action-level tests in the style of `competitor-basis-edits.test.ts` (prisma, session, site reading and `fetch` mocked):

- Keywords: OpenAI non-200, unparseable content, and a result with no keywords each return `keywordsAiFailed` and never call `prisma.workspace.update`; a good result saves; a skipped competitor is saved with `intent_distribution: null`.
- Offerings: extraction failure returns `offeringsAiFailed`, no update, and **only one** OpenAI call (no comparison); an all-empty extraction saves without a comparison call.
- Detector: matches the old fallback shapes, and does not match a real result or an empty workspace.

Plus one live check: the Keywords tab renders a competitor with a `null` split.
