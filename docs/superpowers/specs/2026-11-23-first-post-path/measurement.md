# Measuring the path to the first post (mentee test)

Owner: contivo-cpo · 23 Nov 2026 · goes with `concepts.md`

## Correction to the brief

The brief says "no sign-in or page tracking yet". That is out of date. Migration
`20261121120000_funnel_tracking` is on main and production (release candidate r2, 22 migrations,
"up to date"). It records `USER_SIGNED_UP` (with cohort), `USER_SIGNED_IN`, `SESSION_STARTED`,
`users.lastSeenAt`, and `STEP_VIEWED` for every workspace tab. On a fresh local account on
23 Nov these rows appeared for every step of the walk, which is how the journey map was timed.
The read-only report pack in `.claude/agent-org/work/data/report-pack/` already answers the two
questions:

| Question | Query | Note |
|---|---|---|
| Time to first post | `03_time_to_first_publish.sql` | sign-up → first `publishedAtUtc` / PUBLISHED job, per user + median/p75 |
| Where each team stops | `04_dropoff_per_step.sql` + `12_step_views_dropoff.sql` | highest step reached; last tab viewed before going quiet |
| Mentees vs others | `10_cohort_funnel.sql`, `11_sessions_and_last_seen.sql` | needs `users.cohort` set |

## What is still blind (and the smallest fix)

| Gap | Why it matters for this test | Fix (ships with the chosen concept) |
|---|---|---|
| No view event outside `/growth/[id]`: `/onboarding`, `/growth/new`, `/dashboard`, `/connections` | Two of the four drop-off points Farjad hit are on these pages | Log `STEP_VIEWED` with `tab: 'onboarding' \| 'new' \| 'today' \| 'connections'` from those server pages (same helper, one line each) |
| LinkedIn connect start / return not logged | "The path stops after connecting" cannot be seen in data; `social_connections.createdAt` is overwritten on reconnect | `CHANNEL_CONNECT_STARTED` (on the connect click) and `CHANNEL_CONNECTED` (on the new return landing `/growth/[id]?connected=<platform>` from PR #69, with platform) |
| No "first draft seen" | Separates the two failure modes (path vs trust, see below) | `FIRST_DRAFT_SEEN` when a full draft is first rendered for the workspace (exists today as `CONTENT_PREVIEW_GENERATED_FROM_IDEA`; keep it, and add it to whatever new screen shows the draft) |
| No record of the next-step bar being used | Tells us whether the one-thing bar is the path people take | `NEXT_STEP_CLICKED` `{ stepId, surface }` |

All four are additive `activity_logs` rows: no schema change, no third party, no client analytics
library (decided 21 Nov so mentee data never leaves our database).

## Test protocol (three mentee teams)

1. **Tag them.** Each team signs up from a link with `?cohort=mentee-nov26` (add the value to
   `SIGNUP_COHORTS` on contivo-web — Farjad), or Farjad retro-tags with
   `apps/api/scripts/set-user-cohort.ts`. Without the tag the cohort queries cannot separate them.
2. **No help.** Farjad sends one message: the link and "publish your first LinkedIn post with
   Contivo; don't ask me unless you're stuck for 10 minutes". Every question they do ask is logged
   by Farjad (time, team, question) — that is the "help" count.
3. **Read after 72 h.** Run 03, 04, 10, 12 with `-v since=<test start>`.
4. **Pass:** 3 of 3 teams published, 0 help requests. Report median time to first post.

## Telling "path problem" from "trust problem" (the riskiest assumption)

| What the data shows | Reading |
|---|---|
| Team never reaches `FIRST_DRAFT_SEEN` | Path problem: the concept failed to get them to value. Look at the last `STEP_VIEWED`. |
| Team sees a draft, does not publish within 24 h, and **edits** it heavily or regenerates | Content quality problem (head-of-data). |
| Team sees a draft, does not publish, **no edits, no connect** | Trust/ask problem: they do not want AI posting under their name. Ask them directly. |
| Team connects LinkedIn but does not publish | The return-from-OAuth step still breaks the path. |

## Data handling

Mentee rows are real people's data. Use the anonymised export (`90_anonymised_export.sql`) for
anything that leaves Farjad's machine, and only after the consent step in
`.claude/agent-org/work/data/2026-11-21-capstone-privacy.md`.
