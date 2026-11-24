# First post, Concept B: QA (T6)

contivo-qa-engineer · 23 Nov 2026 (local clock 24 Nov UTC) · branch `myca/first-post-b` @ 5ed44fc · local stack: web :3000 from this worktree, DB :5433, no API of our own (the :3001 API belongs to the journey-bugs worktree and was only hit by the Connect redirect). Driven with headless Chrome (playwright-core over CDP), sign-up/sign-in through the app's own forms only. No token minting, no LinkedIn consent, nothing published.

Screenshots: `docs/superpowers/specs/2026-11-23-first-post-path/qa-b/` (`<tag>-<step>-<1280|375>.png`). Tags: `en` = Balzac's Coffee (failure path), `en2` = Tartine Bakery (timed walk), `fa2` = Tartine Bakery in fa, `fa`/`fa-ksp` = Kitchen Stuff Plus (site unreadable, <2 competitors), `killswitch-*` = FIRST_POST_GUIDED=off.
Note: the app scrolls an inner container, so "full page" shots show the viewport only.

## Verdict
**GO for the Farjad-assisted connect + publish session** on a workspace that reaches a draft (Tartine walk). **NO-GO for production release** until B1 is fixed: any workspace whose competitor evidence has an emoji at char 119-120 can never produce a first post (and its manual matrices projection silently fails too).

## Walk (fresh account, en, Tartine Bakery https://tartinebakery.com)
qa-b-9b55b5@contivo.local. Sign-up submit 00:06:38.242Z → draft shown 00:08:02.398Z = **1 min 24 s, 5 user actions** (baseline 6 m 48 s). Includes ~7 s of QA screenshot overhead.

| t (UTC) | action / screen |
|---|---|
| 00:06:38.2 | #1 submit sign-up |
| 00:06:39.8 | auto: /dashboard → /onboarding → /growth/new (no click) |
| 00:06:45.1 | #2 submit company form → /growth/analyzing |
| 00:06:55.5 | auto: workspace ?from=analyzing, first-post confirm, 7 AI-guess competitors, none ticked, button disabled |
| 00:06:57.4 | #3 tick 1 (still disabled) |
| 00:06:59.0 | #4 tick 2 (enabled, "2 picked · about 2 minutes") |
| 00:07:00.5 | #5 Write my first post → running |
| 00:07:19.9 | matrices done (4 charts, axes auto-chosen) |
| 00:07:46.9 | keywords done (10 gaps) |
| 00:07:51.2 | idea done |
| 00:07:55.8 | draft saved, GENERATED, verdict approved |
| 00:08:02.4 | draft shown; bar "3/4 Publish this on LinkedIn · Connect LinkedIn" |

fa walk (qa-b-f0b3c9, Tartine, fa): 00:25:05.2 → 00:26:56.3 = 1 m 51 s, 5 actions (includes a deliberate 10 s tab-close/reopen resume test).
First en attempt (Balzac's Coffee, https://www.balzacs.com, qa-b-d2baa4): failed at Market map twice (B1); dead end. A third fa attempt (kitchenstuffplus.com) failed at brand analysis (site not readable) and was reused for the <2 test.

Credits: en2 100 → 100 (after run + other angle + recheck); Balzac 100 → 100. `credit_ledger` holds only the welcome grant.

## Acceptance matrix (spec §12 + CPO amendments)
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Confirm | VERIFIED | en2-10-confirm-*, fa2-10-confirm-*; 7 rows, 0 checked, disabled at 0 and 1, enabled at 2. Evidence line is "AI guess" on every row (no sources). |
| 2 | <2 found | VERIFIED | fa-10b-confirm-few-* ("Add the competitors you know", field open, Write my own), fa-10c-confirm-few-added2-* (2 added, arrive ticked, button enabled) |
| 3 | One run, no gate change | VERIFIED | Tartine: 4 charts, no axes prompt (MATRICES_AXES_AUTO_CHOSEN), keywords, 1 idea, content_items GENERATED with qualityVerdict approved=true; credits 100→100; `git diff 61dcb40 HEAD` empty for report-readiness.ts, content-engine.ts, quality-verdict*.ts, schema.prisma |
| 4 | Resume | VERIFIED | fa2: tab closed mid-run, reopened after 8 s: running view, bar `writing`, continued to draft (fa2-11b-running-resumed-*) |
| 5 | Failure | PARTLY VERIFIED | Verified on the **matrices** step (not keywords): 1st failure = reason + Try again (en-13-failed-1st-*); retry; 2nd failure = Write my own + Report a problem (en-14-after-retry-*). Keywords-specific failure and "retry skips matrices" after a keywords failure: UNVERIFIED (could not force a keywords failure without code/env change). Skip of done steps verified via Other angle (STEP_SKIPPED matrices, keywords). |
| 6 | Draft | VERIFIED | en2-12-end-*: post, Why this post (topic gap, 4 charts, 2 competitors, AI-wording note), Edit / Try another angle / Write my own; bar Connect LinkedIn; FIRST_DRAFT_SEEN exactly 1 row after ~10 renders |
| 7 | OAuth return | UNVERIFIED (needs real connect) | Opened `?connected=linkedin` with no connection: notice "LinkedIn connected · …first post is ready" merged into the bar, single button = bar's "Connect LinkedIn" (en2-bar-draft-workspace_connected_linkedin-*, fa2-…). With no connection the bar state is expected to differ; the notice text claims a connection that doesn't exist (URL-driven, B6). |
| 8 | Publish now | UNVERIFIED (Farjad step) | Needs real LinkedIn + API scheduler |
| 9 | W2 | VERIFIED | Pipeline Quick-schedule Publish, card Publish→Confirm Schedule, Edit→Save & schedule: notice "Connect LinkedIn to publish · Nothing was scheduled" / "Saved, but not scheduled"; SQL status GENERATED, scheduledAtUtc NULL after each (en2-21, en2-26, en2-23). First-post view has no Publish button; bar Publish not reachable without a connection. |
| 10 | Bar | VERIFIED for confirm/writing/runFailed/readDraft/connectLinkedIn | 4 surfaces en+fa at 1280/375 (`*-bar-*`). Workspace first-post tab = connectLinkedIn; Today/Connections/pipeline tab = readDraft (as spec table). ≤20 words each (landing line is notice+bar, 34 words). publishNow/publishing/firstPostLive/open mode: UNVERIFIED |
| 11 | Hidden | VERIFIED guided half | Guided: no Instant nav, no tab strip/LoopRail, no stat/AI chips, /onboarding → /growth/new without a click (STEP_VIEWED onboarding then new). Published-user half: UNVERIFIED (no local account with a PUBLISHED item; existing walk account has 0) |
| 12 | Unlock | UNVERIFIED | needs a real publish |
| 13 | W3/W4 | VERIFIED (open UI via kill switch) | Keywords/Ideation tabs show no token counts, model, score, Fallback or (mock) (killswitch-off-en2_tab_keywords/_ideation) |
| 14 | Events | VERIFIED except CHANNEL_CONNECTED | see SQL below; CHANNEL_CONNECTED needs a real finalize |
| 15 | Locales | VERIFIED | `check-i18n.mjs` passed (25 namespaces); fa dir=rtl, Persian digits (۳ از ۴, ۱۰۰); no page-level sideways overflow at 375 on any shot (only the intended scroller on /connections tabs) |
| 16 | Kill switch | VERIFIED | FIRST_POST_GUIDED=off: new sign-up lands on the onboarding fork (Build Workspace / Instant Content), no bar; guided user's workspace shows no first-post view, Instant nav back, ?tab=first-post falls back; W3/W4 absent. Restarted without the flag afterwards (200). W2 under off: not re-tested. |

## Bugs
- **B1 HIGH (pre-existing, blocks first post)** `lib/matrices/persist.ts:50` `trimTitle` = `value.trim().slice(0,120)` cuts a surrogate pair (Detour Coffee evidence title, 🇨🇦 at 119-120) → lone surrogate → `prisma.workspace.update` fails "unexpected end of hex escape" → MATRICES_PROJECTION_FAILED, charts exist but projection missing → first post fails with "We couldn't build enough charts" (wrong reason, 4 charts were built). Permanent for the workspace: all competitor rows are projected, unticking doesn't help. Repro: fresh account, company https://www.balzacs.com, tick Detour + Pilot, Write my first post. Also breaks manual matrices on main.
- **B2 MEDIUM** Brand analysis failed (site unreadable) → first-post still offers confirm/run; run fails instantly as "Something went wrong on our side" (`matrixNeedsBrandSummary` mapped to `generic`, run.ts:149). Should say the site couldn't be read and offer re-analysis / Write my own. Repro: fa account, https://www.kitchenstuffplus.com.
- **B3 LOW** English strings in fa: analysis error "We could not read https://… Check the address…" and the setup-partial banner "Could not read the website." (fa-03b-analyzing-stuck, fa-10b-confirm-few).
- **B4 LOW** STEP_VIEWED written twice per view (onboarding, new, first-post at landing), dev server; inflates funnel counts. Check in prod.
- **B5 LOW** Gate-rejected draft: primary action is "Check again", not Other angle (spec §4.3). "Why this post" keeps the keywords' top gap after Other angle even when the new idea is about something else.
- **B6 LOW** `?connected=linkedin` says "LinkedIn connected" from the URL alone; fa copy mixes "LinkedIn" and «لینکدین».
- **B7 LOW** First-post Edit logs CONTENT_EDITED `held: true` without a schedule request.
- **B8 LOW** Two "Try again" buttons on first failure (bar + view). Spec says one.
- Content risk (head-of-data): draft 1 carries framework labels "Strong Opinion:", "Reason:", "Example:" in the post text, and claims Tartine runs workshops/Saturday classes (unverified, AI wording). Passed the gate.
- Observation: Connect redirect → `www.linkedin.com/oauth/v2/authorization` (then /uas/login, not signed in; no consent possible). A Playwright abort on the first try made the API answer "This connect link was already used" on a reload; an artifact of the block, not reproduced without it.

## activity_logs, en2 (user cmwtxpvjc002wqbfzyetxfhbe), trimmed
```
USER_SIGNED_UP {method: password, locale: en}            00:06:38.579
SESSION_STARTED                                          00:06:39.107
STEP_VIEWED {tab: onboarding} x2                         00:06:39.68
STEP_VIEWED {tab: new} x2                                00:06:39.76
WORKSPACE_CREATED                                        00:06:45.387
WORKSPACE_BASELINE_SNAPSHOT_CREATED                      00:06:52.788
STEP_VIEWED {tab: first-post} x2                         00:06:53.3
COMPETITOR_DECISION_SET ACCEPTED x2                      00:06:57.5 / 00:06:59.0
FIRST_POST_RUN_STARTED {kind: start, runId fpr_…_1, attempt 1, accepted 2} 00:07:00.545
FIRST_POST_RUN_CLAIMED                                   00:07:00.605
MATRICES_STARTED / MATRICES_AXES_AUTO_CHOSEN / MATRICES_GENERATED {charts 4}
FIRST_POST_STEP_DONE {step matrices, ms 19245, charts 4, competitors 2} 00:07:19.856
COMPETITOR_KEYWORDS_GENERATED {gaps 10}
FIRST_POST_STEP_DONE {step keywords, ms 27068, topGap "Artisan Baking Education"} 00:07:46.927
IDEATION_GENERATED; FIRST_POST_STEP_DONE {step idea, ms 4233}          00:07:51.162
CONTENT_PREVIEW_GENERATED_FROM_IDEA; CONTENT_PIPELINE_ITEM_SAVED
FIRST_POST_STEP_DONE {step draft, words 327, approved 1}               00:07:55.774
FIRST_POST_RUN_FINISHED {contentItemId cmwtxrj3u…, approved true}      00:07:55.775
FIRST_DRAFT_SEEN {approved true}                                       00:07:58.481
STEP_VIEWED {tab: today} 00:09:00.996 · {tab: connections} 00:09:07.627 · pipeline x6
CONTENT_EDITED {held true, heldReason no_connection}  (W2 save & schedule) 00:11:55.516
CONTENT_EDITED {held true}; FIRST_POST_DRAFT_EDITED {charsBefore 2165, charsAfter 2149} 00:12:11.9
NEXT_STEP_CLICKED {stepId connectLinkedIn, surface workspace}         00:13:05.877
CHANNEL_CONNECT_STARTED {platform linkedin}                            00:13:05.911
(second connect click, same two rows)                                  00:13:29.9
FIRST_POST_RUN_STARTED {kind otherAngle, runId fpr_…_2}; FIRST_POST_OTHER_ANGLE {n 1}
FIRST_POST_STEP_SKIPPED matrices, keywords; STEP_DONE idea, draft {approved 0}
FIRST_POST_RUN_FINISHED {approved false}                               00:13:59.050
```
Not present: CHANNEL_CONNECTED (needs real finalize), FIRST_POST_PUBLISH_REQUESTED.

## Left for Farjad's connect + publish session
Prereqs: web from this worktree on :3000 (`pnpm --filter web dev`), API from this worktree on :3001 (`cd apps/api && pnpm exec nest start`; stop the journey-bugs API on :3001 first) with `WEB_APP_URL=http://localhost:3000`, Redis up.
1. Sign in as qa-b-9b55b5@contivo.local (password in the QA scratchpad `acct-en2.txt`), open workspace cmwtxq0sl0030qbfz8u4v2h9y. The current draft is the Other-angle item (gate rejected): press "Try another angle" or "Check again" until approved, or edit.
2. Bar → Connect LinkedIn → consent on LinkedIn (personal profile).
3. Confirm the landing `?connected=linkedin`: one button, bar's "Publish now" (#7 amended); CHANNEL_CONNECTED row; social_connections row `isDefault = true` (debt register).
4. Press Publish now (your go): SCHEDULED at now → "Publishing…" → "Your first post is live" + working link within ~2 min (#8).
5. Next render: tabs, LoopRail, header back, Instant nav back, bar = Narrative/Autopilot, no AI chips (#11 second half, #12). Check Today too.
