# First published post: pick a concept

contivo-cpo · 23 Nov 2026 · design only, nothing built · brief: `.claude/agent-org/work/strategy/2026-11-23-first-post-path.md` (B)

## The problem, measured

On a fresh local account (main `41723f8`), getting from sign-up to a **scheduled** post took
**6 min 48 s and ~24 actions**, by someone who already knew the path. Nothing was connected, so
it would never have published. → [journey-map.md](journey-map.md), screenshots in `walk/`.

- **The product has no "first post" step.** `workspace-journey.ts` ends setup at "Autopilot on".
  `publishedCount` is computed and never read.
- **The first draft appears ~6 minutes in**, inside a preview modal on tab 3 of 6, after four AI
  setup steps. That modal has no Publish button.
- **Connect comes before value.** After the narrative, the guide sends the user to `/connections`
  before they have seen a single post.
- **Five surfaces compete to say what is next**: the guide, the "You are here" bar, the Loop rail,
  the header buttons and Today. After keywords there are four "next" destinations at once.
- **Text**: ~900 words on the first workspace screen, and the same 40-word disclaimer 7×.
  Customers also see tokens, model names, "Fallback applied" and "(mock)".

## Three concepts → [concepts.md](concepts.md), mockups in `mockups/index.html`

| | Today | A: guided rail | **B: value before the ask** | C: wizard |
|---|---|---|---|---|
| Actions to first post | ~24 + 4 misdirections | ~15 | **~9** | ~11 |
| Decisions | ~10 | 3 | **3** | 4 |
| Connect LinkedIn | before any post | before the draft | **after reading the draft** | after the draft |
| Server gate change | — | no | **no** | no |
| Engineering | — | S–M | **M** | L |
| Reversible | — | yes (flag) | **yes (flag)** | low |

All three share:
- one next-step bar, with the same words on every page;
- advanced sections hidden until the first post is live;
- the journey ends at "Your first post is live · View on LinkedIn", and Autopilot becomes the step after it;
- a "Write my own instead" escape hatch;
- no Instant Content fork.

## Recommendation: B

B confirms competitors on one screen, then Contivo runs the existing map, keywords and draft chain by itself. The user reads one real post, *then* connects LinkedIn, and comes back to that same post with **Publish now**.

- It is the only concept that puts value first without loosening the quality gate.
- It has the fewest places to quit.
- It cleanly tests the riskiest assumption. Everyone reaches a draft, so a drop between "draft" and "connect" means trust in the content, not the path.

The bar and the hidden sections from A come free with B. If B's orchestration slips, A's half can ship first.

### CPO review notes (added to the designer's work)

1. **Fewer than 2 competitors found.** Production discovery has returned empty before (B10, 22 Nov). B's one screen needs a defined state for this: "Add the ones you know" (≥2), plus "Write my own instead". Without it B stalls at step 1, and the user is stuck on the very screen meant to save time.
2. **No A-vs-B test.** Three teams cannot carry an A/B split. Ship one concept to all three teams and compare against the baseline in the journey map.
3. **Cost.** The manual chain in the walk used **0 credits** (100 → 100); only AI provider spend. B runs the same calls, so by today's rules it is free to the user. Our provider cost per first post still needs a number from head-of-data (`13_ai_cost.sql`).
4. **Default axes.** Today the matrices run pauses for the user to choose axes (`NEEDS_AXES`). B needs an automatic choice. head-of-data should confirm that charts built on default axes still pass `matricesGate` and still produce good drafts.
5. **#69 follow-up.** PR #69 lands OAuth on `?connected=<platform>` with "Publish your first post", which opens an empty write-own-post editor. In B, it must open **the waiting draft** ("Publish this post").

## Decisions for Farjad

1. **Pick A, B or C.** (CPO: B.)
2. If B: are competitors **never pre-ticked** (designer + CPO recommendation, so the user's choice is real), or are the top two ticked for speed?

## Measuring it → [measurement.md](measurement.md)

The tracking already exists on main and production: sign-up with cohort, sign-in, sessions, `STEP_VIEWED`, plus the report pack (time to first post, drop-off per step, last tab before going quiet).

Before the mentee test, add four `activity_logs` events, with no schema change:
- view events for `/onboarding`, `/growth/new`, `/dashboard` and `/connections`;
- connect started and connect returned;
- first draft seen;
- next-step clicked.

Tag the teams with `?cohort=`.

Pass: 3 of 3 teams publish with 0 help requests.

## Defects found on the walk (not part of this design)

- **W1** keywords guide stays stale: taken by the journey-bugs session in #69.
- **W2** Publish with nothing connected schedules silently, then fails with `NO_CONNECTION`.
- **W3** token counts and model shown on the Keywords tab.
- **W4** "Fallback applied / (mock)" in Ideation.
- **W5** Ideation offers platforms that cannot publish.

W2–W5 go to the CTO queue.

## Next, after Farjad picks

1. contivo-ux-ui-designer: screen specs.
2. contivo-cto: orchestration, publish-now, #69 follow-up, the four events, W2–W5.
3. contivo-head-of-data: default axes, AI cost per first post.
4. Spec → plan → build, one PR behind a flag.
