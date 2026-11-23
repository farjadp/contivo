# OpenAI image model: replacing gpt-image-1 (B19)

Owner: contivo-head-of-data. Date: 2026-11-22. Code: `DEFAULT_OPENAI_IMAGE_MODEL` and
`DEFAULT_OPENAI_IMAGE_FALLBACKS` in `apps/web/src/lib/ai/image.ts`.

**Decision: `gpt-image-2.5-flare`, then `gpt-image-2.6-flare`, then `gpt-image-2.5-sunburst`.**

## Why images stopped

`content-image.ts` hardcoded `gpt-image-1`. OpenAI shut it down on **2026-10-23**
(deprecations page; replacement gpt-image-2.5-sunburst or -flare). From then on every call
got `400 "The model 'gpt-image-1' does not exist." (image_generation_user_error)`, and the
caller returned `null`. The last image in production is from 25 Sep. The run said
SUCCEEDED. There was no usage row and no event. QA found it in run 11 of the e2e handover.

The production key lists these image models: gpt-image-1-mini, gpt-image-1.5, gpt-image-2,
gpt-image-2.5-flare/-sunburst, gpt-image-2.6-flare/-sunburst and chatgpt-image-latest. So
this is a retired model, not an org-verification problem.

## Candidates

Shutdowns from developers.openai.com/api/docs/deprecations, read 22 Nov:

| Model | Shutdown | Price per 1M (text in / image out) |
|---|---|---|
| gpt-image-1.5, gpt-image-1-mini, chatgpt-image-latest | **2026-12-01** | — (excluded) |
| gpt-image-2 | **2027-02-10** | — (excluded) |
| gpt-image-2.5-flare / -sunburst | none announced | $5 / $30 |
| gpt-image-2.6-flare / -sunburst | none announced | $5 / $30 |

## Method

Each model was called live on 22 Nov with the production OpenAI key on
`/v1/images/generations`: 1024x1024, quality medium, n=1. There were 3 prompts in the house
style that `buildImageBrief` asks for (flat, editorial, named palette, "no text, no
letters, no logos"):

- **navy:** the neutral fallback brief from `content-image.ts`
- **compass:** teal and coral
- **store:** saffron and deep blue

I judged every picture by eye for brand fit and for text or garbled lettering.

## Results

| Model | Output tokens | $ / image | Latency (3 calls) | Text in image | Brand fit |
|---|---|---|---|---|---|
| **gpt-image-2.5-flare** | 439 | **0.013** | 7.9 / 10.2 / 11.7 s | none | clean, on palette |
| gpt-image-2.5-sunburst | 439 | 0.013 | 9.0 / 12.7 / 13.5 s | none | clean, adds a sun element |
| gpt-image-2.6-flare | 1,449 | 0.044 | **4.3 / 6.6 / 5.7 s** | none | clean, on palette |
| gpt-image-2.6-sunburst | 1,449 | 0.044 | 11.5 / 14.9 / 17.7 s | none | clean, on palette |

All 12 pictures followed the brief, and none had text, letters or logos. On these prompts
the quality difference is too small to pay 3.3× for.

## Why 2.5-flare

- **Same quality as 2.6 at a third of the cost.** $0.013 vs $0.044 per image. Autopilot makes
  one picture per draft, so this is the line that scales.
- **Latency is fine.** Autopilot runs unattended, and about 10 s is acceptable for the manual
  "Generate image" button.
- **No announced shutdown.**
- **Fallbacks.** 2.6-flare is first: a newer generation, so it likely outlives a 2.5 shutdown,
  and it is the fastest. 2.5-sunburst is second.

## Live check of the shipped code (22 Nov, production key)

- **Default chain:** gpt-image-2.5-flare, 12.5 s, 439 tokens, picture clean.
- **`OPENAI_IMAGE_MODEL=gpt-image-1`:** a real 400 "does not exist" is classed `model_gone`.
  One `ai_provider_events` row is written (`task=content_image`), and the call falls over
  to gpt-image-2.6-flare, which succeeds.
- **`gpt-image-1` + `dall-e-3` only:** the run ends with `IMAGE_MODEL_UNAVAILABLE` and logs
  "post goes out text only".

## Limits and overrides

- n = 3 prompts × 1 run per model. This is enough to rule out a broken model and compare cost,
  but it is not a full aesthetic eval. Re-run before changing the default.
- Change the model without a deploy: `OPENAI_IMAGE_MODEL` (one model) and
  `OPENAI_IMAGE_FALLBACK_MODELS` (comma list).
- Shutdowns for gpt-image-1/-1.5/-1-mini/chatgpt-image-latest/-2 are in
  `MODEL_SHUTDOWNS`. CI goes red 14 days before a default reaches its date.
