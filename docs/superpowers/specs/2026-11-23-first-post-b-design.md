# First post, Concept B ("value before the ask"): design

contivo-cto · 23 Nov 2026 · phase 1 (spec + plan, no app code) · branch `myca/first-post-b` (from origin/main `61dcb40`, includes #69)
Inputs: PR #70 `docs/superpowers/specs/2026-11-23-first-post-path/` (README CPO notes 1–5, concepts.md "What all three share" + "Concept B", journey-map.md, measurement.md, mockups/concept-b.html). Plan: `docs/superpowers/plans/2026-11-23-first-post-b-plan.md`.

File references are `apps/web/src/...` unless they start with `apps/api`. Line numbers are at `61dcb40`.

## 1. What changes, in one paragraph

A signed-in user with **no published post anywhere** ("guided mode") lands, after the brand analysis, on a new workspace view `?tab=first-post`. It asks one thing: tick at least 2 real competitors. "Write my first post" starts **one server-side run**: matrices with automatically chosen axes → competitor keywords → ideation (1 idea, LinkedIn, no image, no calendar insert) → a full preview draft through the existing quality gate → saved as a pipeline item. The view shows each finished step's real result and survives a closed tab. The user reads the draft, then the single next-step bar says "Publish this on LinkedIn · Connect LinkedIn". OAuth returns to the same draft with **Publish now** (schedule at now; the scheduler cron picks it up within a minute). The view waits for the job and shows the live LinkedIn link. Until then, the advanced chrome is hidden. After the first publish everything comes back and the bar moves on. W2, W3 and W4 are fixed for everyone.

## 2. Decisions

| # | Decision | Why (grounded) |
|---|---|---|
| D1 | **No feature flag. Guided mode = the user has 0 PUBLISHED content items in any workspace AND no enabled autopilot policy. Kill switch: `FIRST_POST_GUIDED=off` on contivo-web restores today's UI.** | Mentee teams are on production now; a flag nobody turns on would test nothing. "Any workspace" = `contentItem.count({ where: { userId, status: 'PUBLISHED' } })` (`ContentItem.userId`, schema `model ContentItem`). The autopilot clause is mine: a user whose autopilot is already on would otherwise lose the Autopilot tab and header button (`growth/[id]/page.tsx:583-603`) while it runs. Users who already published see no change except W2–W4. |
| D2 | **The view is a workspace tab, `?tab=first-post`, not a new route.** | `resolveTab` (`growth/[id]/page.tsx:121-139`) and the `STEP_VIEWED` write (`:392-399`) already cover tabs; ownership is checked once (`:153-173`); the `?connected=` landing is this same page (`:370-388`). A route would need `routing.ts` pathnames (shared with the blog/compare streams) and a second ownership load. In guided mode the default tab (today `'pipeline'`, `:137`) becomes `'first-post'`; outside guided mode `first-post` is not an allowed tab and falls back as today. |
| D3 | **Run driver: the existing background-run pattern.** Server action `startFirstPost` → `triggerBackgroundRun('/api/first-post/run', { runId })` (`lib/background-run.ts:78`) → route checks `CRON_SECRET` with `timingSafeEqual` and hands `runFirstPost(runId)` to `after()`, exactly like `app/api/matrices/run/route.ts:33-60`. Inside the run, the matrices step calls `runMatrixPipeline` **in process** (no second HTTP hop). | Proven in production by matrices and discovery. The route takes only `runId`; user and workspace come from the run row written by an ownership-checked action (same reasoning as `api/matrices/run/route.ts:10-18`). `WEB_APP_URL` trap: `resolveWebAppUrl` falls back to `NEXT_PUBLIC_APP_URL`, then `localhost:$PORT` (`background-run.ts:51-60`); matrices already depend on it in prod, so no new env var. Locally the API's `WEB_APP_URL` must match the web dev port, or OAuth returns to nowhere (HANDOFF.md:141-142). A dispatch failure marks the run failed at once (same as `growth-matrices.ts:160-180`). Considered: `after()` inside the server action (used by `actions/bug-report.ts:24`): fewer parts, but it would be the only multi-minute job not on the proven path. |
| D4 | **Default axes: the first 2 of the AI-proposed market axes, chosen inside the same matrices run.** `runMatrixPipeline(runId, { autoAxes: 2 })`: when the workspace has no stored market axes (`pipeline.ts:250-251`), it takes `normaliseMarketAxes(candidates, 2)`, saves them to `workspace.matrixAxes` (as `saveMatrixAxes` does, `growth-matrices.ts:269-272`), logs `MATRICES_AXES_AUTO_CHOSEN`, and continues to SCORE instead of stopping at `NEEDS_AXES` (`pipeline.ts:255-267`). | 2 core axes (`axes.ts:30`) + 2 market = 4 charts, one above `REQUIRED_MATRIX_CHARTS = 3` (`report-readiness.ts:26`), matching the walk (4 charts). One run, so competitor enrichment is not done twice. Without the option the pipeline is unchanged (manual users still choose). Zero valid candidates → 2 charts → `matricesGate` fails → the step fails honestly (§6). head-of-data still has to confirm default axes give good drafts (CPO note 4). |
| D5 | **Run state lives in `activity_logs`. No schema change.** | `activity_logs` has `id TEXT PK`, `workspace_id`, `action`, `detail JSONB`, indexed on `(workspace_id, created_at desc)` (schema `model activity_logs`; `lib/activity-log.ts:55-75`). The run row id is deterministic, `fpr_<workspaceId>_<attempt>`: two concurrent starts compute the same id and the second insert fails with P2002, which is the lock (same idea as the partial unique index on matrix runs, `growth-matrices.ts:150-155`). Each step writes `FIRST_POST_STEP_DONE` / `FIRST_POST_STEP_FAILED` with `runId`. The real artifacts (charts, keywords, the content item) are what is "kept"; the log only says where the run is. |
| D6 | **Publish now = schedule at now**, through a new result-returning action. The scheduler's `@Cron(EVERY_MINUTE)` (`apps/api/src/modules/social/social-scheduler.service.ts:43`) claims `SCHEDULED` items with `scheduledAtUtc <= now` (`:58-64`), resolves the default connection (`:121-129`), claims SCHEDULED→PUBLISHING atomically (`:144-148`) and creates the job. | One publish path for every post. Direct `POST social/publish-jobs` (`social-publish.controller.ts:41`) would need a server-side minted API token, would duplicate connection resolution, and would skip the scheduler's claim. Cost: up to ~60 s + queue time, which fits the copy "under a minute". The quality gate stays where it is (`enforceQualityGate`, `actions/calendar.ts:63`). |
| D7 | **W2: no schedule without a connection.** One check, `assertPublishTarget(workspaceId, channel)`: a CONNECTED + `isDefault` social connection for `CHANNEL_TO_PLATFORM[channel]` (`packages/types/src/domain/social.ts:37`), or an active site connection for `blog`. It is used by publish-now, `scheduleContentItem` (`calendar.ts:50`) and the scheduling branch of `updateContentAndSchedule` (`:108-155`). Failure is **returned**, not thrown. | The scheduler refuses the same case at due time (`social-scheduler.service.ts:131-141`), so refusing at schedule time changes no outcome except making it visible. Today PipelineTab swallows every thrown error into `console.error` (`PipelineTab.tsx:592-594, 614-616`), and Next redacts thrown messages in production. That is why the refusal has to be a return value. |
| D8 | **Credits: the run charges 0 credits.** | Only Autopilot (`AUTOPILOT_IDEATION` 2, `AUTOPILOT_DRAFT_ATTEMPT` 7) and images (3) are charged (`lib/credit-costs.ts:24-33`; `chargeCredits` has callers only in `lib/autopilot/runner.ts:393,471`). The manual chain (`actions/workspace.ts:22-38`) charges nothing, and the walk measured 100 → 100. So the run fits 100 starting credits by today's rules. Provider cost is uncapped: see the debt register. |
| D9 | **Strings**: bar copy in `messages/*/workspace.json` under a new `nextStep` key; first-post view copy in `messages/*/tabs-a.json` under `tabsA.firstPost`. No new namespace, so `i18n/request.ts` is untouched (`request.ts:30-46`). | Separate files for the two frontend tasks, so they never edit the same file. |

## 3. Data flow

```
analysis done ── AnalyzingRunner.tsx:80 navigates to ?tab=strategy
   (change: no tab param, so guided mode defaults to first-post;
    open mode resolves to strategy exactly as today)
        │
?tab=first-post  (server: page.tsx loads FirstPostState)
   ├─ no run yet ─→ CompetitorConfirm
   │     tick → setCompetitorDecision (growth-competitors.ts:588), add → addManualCompetitor (:816)
   │     "Write my first post" → startFirstPost(workspaceId)  [server action]
   │          authorise · accepted >= 2 · insert fpr_<ws>_<n> (P2002 = already running)
   │          triggerBackgroundRun('/api/first-post/run', { runId })
   ├─ run active ─→ RunProgress (polls getFirstPostState every 3 s)
   │
   │   runFirstPost(runId)  [background, after()]
   │     1 MATRICES  skip if matricesGate ok and not stale (same rule as growth-matrices.ts:242-245)
   │                 else createMatrixRunRow(owned) + await runMatrixPipeline(id, { autoAxes: 2 })
   │                 then re-read audienceInsights: matricesGate(...) must be ok
   │     2 KEYWORDS  skip if competitorKeywordsIntel.competitors.length > 0
   │                 else generateCompetitorKeywordsCore(actor)   (extracted from growth-keywords.ts:599-707)
   │     3 IDEA      ideateForWorkspace(actor, { platform:'linkedin', requestedIdeaCount:1,
   │                   selectionMode:'auto', includeImages:false, autoInsertToCalendar:false,
   │                   steeringNotes: previous topics to avoid, on "other angle" })  (content-engine.ts:306)
   │     4 DRAFT     generateDraftPreviewCore(actor, idea) → preview + verdict + verdictToken (:569-674)
   │                 saveIdeaToPipelineCore(actor, { ...idea, auto_insert_to_calendar:false },
   │                   { body: preview, verdictToken }) → ContentItem GENERATED + qualityVerdict (:424-561)
   │     FIRST_POST_RUN_FINISHED { runId, contentItemId, approved }
   │
   ├─ draft ready ─→ DraftCard: post text, "Why this post", Edit · Other angle · Write my own instead
   │     bar "Publish this on LinkedIn · Connect LinkedIn" → getSocialConnectUrl('linkedin', ws)
   │       (actions/social-connect.ts:58) → LinkedIn → /connections?pending= → finalize →
   │       redirect /growth/[id]?connected=linkedin   (connections/page.tsx:71-78, connect-return.ts:35-41)
   ├─ connected + draft ─→ PublishPanel: "Publish now" → publishNow(contentItemId)
   │       enforceQualityGate · assertPublishTarget · status SCHEDULED, scheduledAtUtc = now
   │       poll getPublishProgress(contentItemId): item + latest job → resolvePublishOutcome
   │       (lib/publish-outcome.ts:142-178) until published | failed
   └─ published ─→ PublishedCard: "Your first post is live · View on LinkedIn" (safePostUrl(externalPostUrl))
                   guided mode ends on the next render; tabs, LoopRail and header come back
```

Notes:
- Steps 1–2 run only when needed, so a user who already has charts and keywords goes straight to the idea. Users with 0 posts mid-chain are normal; Farjad's test accounts are like this.
- Every step calls the same function the manual UI calls. `loadIdeationContext` (`content-engine.ts:272-304`) still runs `matricesGate` and the keywords check. **No gate is changed or bypassed.**
- `ideateForWorkspace` defaults `autoInsertToCalendar` to true (`:321`), and `saveIdeaToPipelineCore` then writes `CONTENT_CALENDAR_MOCK_INSERTED` (`:508-523`). The run passes false to both.
- Ideation, preview and save take `{ userId, workspaceId }` actors and no session, so they already run headless; the autopilot runner calls them the same way (`lib/autopilot/runner.ts:379-388, 429`). Matrices and keywords need extraction (§8).

### FirstPostState (one read model; drives the view and the bar)

`lib/first-post/state.ts`: a pure `deriveFirstPostState(logs, facts, now)` plus a loader.

```ts
type FirstPostStep = 'matrices' | 'keywords' | 'idea' | 'draft';
type FirstPostState =
  | { phase: 'confirm'; accepted: number; suggestions: number }
  | { phase: 'running'; runId: string; done: StepResult[]; current: FirstPostStep; startedAt: string }
  | { phase: 'failed'; runId: string; done: StepResult[]; failed: FirstPostStep; errorKind: FirstPostErrorKind; retriesLeft: 0 | 1 }
  | { phase: 'draft'; contentItemId: string; approved: boolean; linkedIn: LinkedInState }
  | { phase: 'publishing'; contentItemId: string }
  | { phase: 'published'; contentItemId: string; url: string | null; publishedAtUtc: string | null };
type StepResult = { step: FirstPostStep; summary: Record<string, string | number> }; // stored counts/names only
type LinkedInState = { connected: false } | { connected: true; accountName: string };
```

- `running` with no new step row for more than **15 min** becomes `failed` with `errorKind: 'timedOut'` (a deploy restart kills an in-flight `after()`). This is the same idea as `reapStaleMatrixRuns`, `pipeline.ts:413-427`.
- The draft pointer is the newest `FIRST_POST_RUN_FINISHED.contentItemId` whose item still exists in this workspace. Item status SCHEDULED or PUBLISHING gives `publishing`, PUBLISHED gives `published`.
- Step summaries come only from stored data: matrices `{ charts, competitors }` from the projection; keywords `{ competitors, gaps, topGap }` from `content_gaps[0]` (`growth-keywords.ts:70-74, 87`); idea `{ topic }`; draft `{ words, approved }`. A missing value is omitted. We never invent one: mockup B2's "Nearest to you: Core Motion" appears only if the projection holds that fact.

## 4. The screens (word budgets from concepts.md §6)

**4.1 Confirm competitors** (≤ 60 words + 1 evidence line each). The workspace's competitor rows, each with a checkbox, name + domain, and one evidence line from `splitEvidence(evidence)` (`growth/[id]/_components/competitor-discovery-logic.ts:188`): the first source's host, or "AI guess" when there is none. **Nothing is ticked in advance, except rows the user already accepted earlier** (those are the user's own decisions). Ticking calls `setCompetitorDecision(..., 'ACCEPTED' | 'PENDING')`. "Add one we missed" calls `addManualCompetitor`; the new row arrives ticked (the user typed it). One disclaimer line for the whole list. The button is disabled below 2 ticks, and the server re-checks (`startFirstPost` refuses with `needTwoReviewed`).
- **Fewer than 2 suggestions** (CPO note 1, discovery returned empty): heading "Add the competitors you know", the add field open by default, and an always-visible secondary link "Write my own instead" → `?tab=pipeline&write=1` (WritePostPanel, from #69).

**4.2 Run progress** (≤ 60 words). Four rows: Market map · Topic gaps · Your post's angle · Writing the post. A finished row shows its summary; the current row shows a spinner; "You can leave this page. It keeps going." The bar is in its no-button state.
- **Failure**: the failed row says which step failed and why, in plain words (§6), with one button, "Try again". It calls `startFirstPost` again; the new attempt skips finished steps, and `retriesLeft` drops to 0. A second failure on the same step replaces the retry with "Write my own instead" and the existing report-a-problem link. Finished rows stay ticked.

**4.3 Draft** (≤ 40 words around the post). The post text as it will be published (`textForChannel` is already applied, `content-engine.ts:626`). "Why this post" lists only stored facts: the topic gap the idea targets (when keywords carry one), "Market map ready · {charts} charts · View" → `?tab=matrices`, and Keywords → `?tab=keywords`. Actions:
- **Edit**: inline editor. Saves through `updateContentAndSchedule` with no date (saving never schedules, `calendar.ts:101-108`). Editing a gated body resets the verdict to "not checked" (`:127-137`), and the existing "Check again" (`actions/quality-gate.ts:14`) runs before publish. Logs `FIRST_POST_DRAFT_EDITED { charsBefore, charsAfter }`.
- **Other angle**: `firstPostOtherAngle(workspaceId)` reruns steps 3–4 only, with `steeringNotes` that avoid the previous topic(s). The old item stays in the pipeline as an ordinary draft. Logs `FIRST_POST_OTHER_ANGLE`. Capped at 3 per workspace (debt register).
- **Write my own instead**: `?tab=pipeline&write=1`, logged as `NEXT_STEP_CLICKED { stepId: 'writeOwn' }`. A post published from there counts as the first post.
- **Gate rejected** (`approved: false`): the existing `QualityVerdictNotice` above the post, with Other angle as the primary action. "Publish anyway" keeps its current override semantics (`calendar.ts:11-18`). No gate change.

**4.4 Publish** (≤ 35 words). "LinkedIn connected as {accountName}" (`SocialConnection.accountName`). **Publish now** is primary; "Schedule for later" links to the existing schedule controls on the pipeline card. While waiting, "Publishing to LinkedIn… under a minute", polling every 3 s for 3 min. After that, "Still publishing. The link appears here when LinkedIn confirms.", polling every 15 s. On failure, `resolvePublishOutcome` gives `failed` + `failureAction` (reconnect/connect), and the existing `PublishOutcomeNotice` renders it.

**4.5 Published** (≤ 30 words + the unlocked list): "Your first post is live · View on LinkedIn ↗" (`safePostUrl`, `publish-outcome.ts:128-136`), the published time, and one line "Your workspace is fully open" with the unlocked tools listed once.

## 5. One next-step bar

- **One function**: `buildNextStep(input): NextStep` in `lib/next-step.ts` (pure). Input: `{ guided, workspaceId | null, journey, firstPost: FirstPostState | null, surface }`. Output: `{ id: NextStepId, counter?: { n, total: 4 }, line: Msg, why?: Msg, action?: { label: Msg; kind: 'link' | 'connectLinkedIn' | 'publishNow'; href?: string }, busy: boolean }`. It uses `Msg` from `workspace-journey.ts:31-36`, so the component does the translating, as JourneyGuide does.
- **`buildJourney` gains a `firstPost` end step** (`StepId` += `'firstPost'`, `workspace-journey.ts:17`). It is appended last, `done = publishedCount > 0`, never locked (writing your own needs nothing), href `?tab=first-post`. `completed / total / percent / isComplete / next` are computed over the six setup steps only (`:251-261`), so JourneyGuide and Today show exactly what they show today for users who have published. JourneyGuide and Today's moves skip `firstPost`.
- **States** (en + fa copy is in concepts.md "Bar copy, en + fa"; ≤ 20 words each):

| NextStepId | When | Line · button |
|---|---|---|
| `addCompany` | guided, no workspace | Add your company to start · Add company → `/growth/new` |
| `confirmCompetitors` | phase confirm | 1/4 Confirm who you compete with · Confirm competitors → `?tab=first-post` (+ why) |
| `writing` | phase running | 2/4 Writing your first post… about 2 min · (no button) |
| `runFailed` | phase failed | 2/4 {Step} didn't finish · Try again → `?tab=first-post` |
| `readDraft` | phase draft, not on the first-post tab | 3/4 Your first post is ready · Read it |
| `connectLinkedIn` | phase draft, on the first-post tab, LinkedIn not connected | 3/4 Publish this on LinkedIn · Connect LinkedIn (+ why) |
| `publishNow` | phase draft, LinkedIn connected | 4/4 LinkedIn connected. Publish your first post. · Publish now |
| `publishing` | phase publishing | 4/4 Publishing to LinkedIn… under a minute · (no button) |
| `firstPostLive` | phase published, on the first-post tab | Your first post is live · View on LinkedIn |
| open mode | published anywhere | `autopilot` ("Let Contivo post every week · Set up Autopilot") when the autopilot tab is not gated (`tabGate`, `workspace-journey.ts:281-287`); otherwise `narrative` ("Sharpen what you stand for · Draft the narrative", why "Autopilot writes from it."); otherwise `journey.next` as today; no bar when setup is complete. |

- **New fa copy** (written natively, for `runFailed` and the open-mode narrative state): «{step} کامل نشد · دوباره امتحان کنید» · «روشن کنید از چه دفاع می‌کنید · نوشتن روایت» · why «اتوپایلت از روی همین می‌نویسد.» The it, es and he files get real translations of the same keys. `scripts/check-i18n.mjs` fails on missing keys or ICU mismatches.
- **Where**: a server component `NextStepBar` (`components/next-step/NextStepBar.tsx`), sticky under the top bar, at the top of the workspace page, Today (`dashboard/page.tsx`) and Connections (`connections/page.tsx`). Each page builds the input with `loadNextStepInput(userId, workspaceId)` (`lib/next-step-load.ts`). Today uses the workspace it already picks (`dashboard/page.tsx:103-110`); Connections uses `resolveWorkspaceScope` with the last-workspace cookie (`connections/page.tsx:107-111`). On the `?connected=` landing, `ChannelConnectedNotice` (`page.tsx:636`) becomes the bar's one-time confirmation line, and its button is the bar's action (no second CTA).
- **Guided mode replaces, open mode keeps**: in guided mode the workspace page skips the header CTAs (`page.tsx:583-603`), the 7 stat chips (`:606-626`), JourneyGuide (`:639`) and LoopRail with its tab strip (`:642-674`). The gate banner (`:677-695`) points at the bar's action. Today skips the loop section (`dashboard/page.tsx:315`) and "Next moves" (`:385-437`), and drops the Autopilot-off and competitors-waiting cards. Open mode is unchanged.
- Clicking any bar button first awaits `recordNextStepClick(stepId, surface)` (one insert), then navigates. For `connectLinkedIn` the OAuth redirect waits for it, so the row is not lost to the page unload.

## 6. Failure states

| Where | Cause (code) | User sees | Kept |
|---|---|---|---|
| start | < 2 accepted (`needTwoReviewed`) | button disabled; server message if forced | ticks |
| start | run already active (P2002 on the run id) | the running view, no error | — |
| start | dispatch failed (`DISPATCH_FAILED`, `background-run.ts:78-123`) | "We couldn't start. Try again." | ticks |
| matrices | run FAILED (`classifyRunError`, `growth-matrices.ts:92-104`: timedOut / notEnoughEvidence / aiUnavailable / generic), or gate not ok after DONE (`notEnoughAxes`) | "Market map didn't finish." + the plain reason; Try again | — |
| keywords | `notEnoughCompetitorSignals` / `keywordsAiFailed` / `keywordsFailed` (`growth-keywords.ts:633-675`) | "Topic gaps didn't finish." For signals: "We couldn't read enough of your competitors' sites. Add another competitor or write your own." | market map |
| idea | `{ error }` from `ideateForWorkspace` (`content-engine.ts:307-308, 338-340, 408-411`) | "Couldn't find an angle." Try again | map, gaps |
| draft | `AI generation failed` (`:623`) or a save error | "Writing didn't finish." Try again | map, gaps (the idea is redone on retry) |
| draft | gate rejects | draft with QualityVerdictNotice (§4.3) | everything |
| run | no step row for 15 min | `timedOut`: "This took too long and stopped." Try again | finished steps |
| publish | no connection (W2) | "Connect LinkedIn to publish" + Connect; nothing scheduled | draft |
| publish | gate blocked (`quality_gate_blocked`) | QualityVerdictNotice | draft |
| publish | job FAILED (reconnect, rate limit, platform) | `PublishOutcomeNotice` with its action | draft |

Raw provider errors never reach the client (same rule as `growth-matrices.ts:98`). `errorKind` is a closed enum.

## 7. Events (all `activity_logs`, no schema change)

| Action | Written by | detail |
|---|---|---|
| `STEP_VIEWED` | the `/onboarding`, `/growth/new`, `/dashboard` and `/connections` server pages, via `logStepView` | `{ tab: 'onboarding' \| 'new' \| 'today' \| 'connections' }`. The workspace page keeps its own write and gains `'first-post'` |
| `CHANNEL_CONNECT_STARTED` | `getSocialConnectUrl` on success (`social-connect.ts:58`) | `{ platform, surface? }` |
| `CHANNEL_CONNECTED` | `connections/page.tsx` when `finalizeSocialConnect` returns `ok` (`:71-78`) | `{ platform }`. Written at finalize, not on the `?connected=` landing, so reloading the landing cannot count it twice. This deliberately deviates from measurement.md |
| `FIRST_DRAFT_SEEN` | first-post tab render, once per workspace (checks for an existing row) | `{ contentItemId, approved }`. `CONTENT_PREVIEW_GENERATED_FROM_IDEA` stays |
| `NEXT_STEP_CLICKED` | `recordNextStepClick` server action | `{ stepId: NextStepId, surface: 'workspace' \| 'today' \| 'connections' \| 'connected' }`, both checked against closed lists; anything else is dropped |
| `FIRST_POST_RUN_STARTED` | `startFirstPost` (row id `fpr_<ws>_<n>`) | `{ runId, attempt, accepted }` |
| `FIRST_POST_STEP_DONE` / `_SKIPPED` / `_FAILED` | `runFirstPost` | `{ runId, step, ms, summary }` / `{ runId, step }` / `{ runId, step, errorKind }` |
| `FIRST_POST_RUN_FINISHED` | `runFirstPost` | `{ runId, contentItemId, approved }` |
| `FIRST_POST_OTHER_ANGLE`, `FIRST_POST_DRAFT_EDITED`, `FIRST_POST_PUBLISH_REQUESTED` | actions | ids and lengths only, never post text |

These are fire-and-forget like today's `STEP_VIEWED` (`page.tsx:392-399`). The exception is the run's own rows: they are awaited, because they are the state.

## 8. Refactors this needs (behaviour-preserving)

1. `startRun` in `app/actions/growth-matrices.ts:111-183` moves to `lib/matrices/start-run.ts` as `createMatrixRunRow(owned)` (reap, active check, selection, create, `MATRICES_STARTED`) plus a dispatch wrapper. The action keeps its exact results, and `growth-matrices.test.ts` must pass unchanged.
2. `app/actions/growth-keywords.ts` is a `'use server'` file (line 1) whose helpers are all module-private. They move to `lib/competitor-keywords/generate.ts` with `generateCompetitorKeywordsCore(actor): { ok: true; payload } | { ok: false; errorKey }`, and the action becomes session → core → `actionError`. `growth-keywords.test.ts` must pass unchanged.
3. `lib/matrices/pipeline.ts`: `runMatrixPipeline(runId, options?: { autoAxes?: number })`, a branch of about 15 lines at `:250-268`. **Overlap: draft PR #30 edits this file (model literal only) and `growth/[id]/page.tsx` (MODEL_RATES only).** The hunks are small and separate; contivo-release-manager must know.

## 9. Hidden until the first post, and when it returns

Guided mode (D1) hides:
- the header CTAs, stat chips, JourneyGuide, and LoopRail with its tab strip;
- the gate banner's own CTA (it points at the bar instead);
- Today's loop, moves, Autopilot-off and competitors-waiting sections;
- the **Instant Content** nav item (`components/layout/app-shell.tsx:31`; the server layout `(dashboard)/layout.tsx` passes `hideInstant` to the client `AppShell`);
- the onboarding fork: `/onboarding` logs `STEP_VIEWED` and redirects to `/growth/new` (the two cards are at `(onboarding)/onboarding/page.tsx:39-85`).

`/instant` stays reachable by URL. Tabs other than `first-post` stay reachable by URL and from "Why this post". The Market tab itself does not change.

It all returns on the first render after any of the user's content items is PUBLISHED, or once an autopilot policy is enabled, or when `FIRST_POST_GUIDED=off`.

**Always, in both modes:**
- **W3**: remove the "last keyword run tokens / lifetime tokens / model" block from `CompetitorKeywordsTab.tsx:182-230`. The data stays in `token_usage` for admin.
- **W4**: remove the "Overall Score", "Fallback applied" and calendar auto/mock badges from `IdeationTab.tsx:506-527`. The logs keep `fallbackUsed` (`content-engine.ts:355-356`).

The header stat chips "AI calls / AI tokens / est. cost" stay visible in open mode, because published users see them today (see Q3).

## 10. Kill switch and rollback

`FIRST_POST_GUIDED=off` (contivo-web, server-only, read in `lib/first-post/mode.ts`) turns guided mode off for everyone:
- `first-post` is not an allowed tab;
- the bar is not rendered;
- `connectedNextAction` keeps #69's behaviour;
- AnalyzingRunner's landing resolves to `strategy`.

W2–W4, publish-now on the pipeline card and the events stay on, because they are defect fixes. Rolling back further means reverting the PR. There is no migration to undo.

## 11. Security notes (for contivo-security-engineer)

- `/api/first-post/run` checks the bearer `CRON_SECRET` with `timingSafeEqual` and takes a body of `{ runId }` only. It loads the `activity_logs` row by id, requires the action `FIRST_POST_RUN_STARTED`, and takes user and workspace from that row.
- Every new server action calls `getSession()` and checks ownership with `workspace.findFirst({ id, userId })`, so a missing workspace and someone else's look the same (`growth-matrices.ts:72-80`). `publishNow` loads the item by `{ id, userId }` (`calendar.ts:21-28`).
- Event detail never holds post text, tokens or URLs from the client. `stepId` and `surface` are enum-checked.

## 12. Acceptance criteria (Given / When / Then)

1. **Confirm**: Given a new user whose analysis found ≥ 2 competitors, When the analysis finishes, Then they land on `?tab=first-post` and see the competitors with one evidence line each, none ticked, and "Write my first post" stays disabled until 2 are ticked.
2. **< 2 found**: Given discovery returned 0–1 competitors, When the user lands, Then they see "Add the competitors you know" with the add field open and "Write my own instead"; adding 2 enables the button.
3. **One run, no gate change**: Given 2 accepted competitors and no charts or keywords, When the user clicks "Write my first post", Then one run produces ≥ 3 charts that pass `matricesGate` without asking for axes, then keywords, 1 LinkedIn idea, and a GENERATED pipeline item with a stored `qualityVerdict`, with 0 credits charged; and `loadIdeationContext` and `matricesGate` are unmodified (diff check).
4. **Resume**: Given a run in progress, When the user closes the tab and reopens the workspace, Then the progress view shows the finished steps with their real results and continues.
5. **Failure**: Given the keywords step fails, Then the view says "Topic gaps didn't finish" with the reason and one "Try again", and the market map row stays done; the retry skips matrices; a second failure replaces the retry with "Write my own instead".
6. **Draft**: Given the run finished, Then the draft shows the post, "Why this post" with stored facts only, and Edit / Other angle / Write my own instead; the bar reads "Publish this on LinkedIn · Connect LinkedIn"; and `FIRST_DRAFT_SEEN` is written once.
7. **OAuth return (#69 follow-up)**: Given a first-post draft and a successful LinkedIn connect, When the user lands on `?connected=linkedin`, Then the notice button reads "Publish this post" and opens `?tab=first-post` in the publish state. Given no first-post draft, Then #69's behaviour is unchanged (the `connect-return.test.ts` cases still pass).
8. **Publish now**: Given the draft and a connected LinkedIn, When the user clicks "Publish now", Then the item is SCHEDULED at now, the view shows "Publishing…", and within ~2 min it shows "Your first post is live" with a working `externalPostUrl` link (verified locally against the real API scheduler).
9. **W2**: Given no connected LinkedIn, When anyone presses Publish or Save & schedule on a LinkedIn item (pipeline card or first-post view), Then nothing is scheduled and the user sees "Connect LinkedIn to publish" with a connect button.
10. **Bar**: Given each state in §5, Then the workspace page, Today, Connections and the `?connected=` landing show the same line and button, ≤ 20 words (unit test on `buildNextStep` + one screenshot per surface).
11. **Hidden**: Given guided mode, Then none of the §9 items render, and `/onboarding` goes straight to "Your company". Given a user with ≥ 1 published post, Then the workspace page and Today render as on `61dcb40` except W3/W4 (screenshot diff).
12. **Unlock**: Given a first post that was just published, When any page renders next, Then the tabs, LoopRail and header return, and the bar reads "Set up Autopilot" (or the narrative state when the autopilot tab is gated).
13. **W3/W4**: Given any user, Then the Keywords tab shows no token counts or model name, and Ideation shows no score, "Fallback applied" or "(mock)" badge.
14. **Events**: Given the walk in criteria 1–8, Then `activity_logs` holds `STEP_VIEWED` for onboarding/new/first-post/today/connections, `CHANNEL_CONNECT_STARTED`, `CHANNEL_CONNECTED`, `FIRST_DRAFT_SEEN`, `NEXT_STEP_CLICKED`, and the `FIRST_POST_*` run rows (an SQL listing goes in the QA report).
15. **Locales**: `node apps/web/scripts/check-i18n.mjs` passes, and en and fa are checked on screen at 1280 and 375 px (fa in RTL, with Persian digits).
16. **Kill switch**: Given `FIRST_POST_GUIDED=off`, Then a new user sees today's UI (fork, guide, tabs), and W2–W4 still hold.

## 13. Tech debt register

| Item | Cost to leave | Cost to fix |
|---|---|---|
| Run state in `activity_logs` (a log used as state) | Each render derives the state from up to 50 rows. That is fine for one-off runs, but it becomes hidden coupling if reused for anything recurring | 0.5 d: a `first_post_runs` table + migration, if B stays |
| Three `WorkspaceFacts` builders: `growth/[id]/page.tsx:283-303`, `dashboard/page.tsx:193-208`, plus the new `loadNextStepInput` | The facts can drift, and then the bar disagrees between surfaces, which is the very bug this design removes | 0.5 d: one `loadWorkspaceFacts`, used by all three |
| No provider-cost cap on manual and first-post AI calls (0 credits) | Retries and Other angle run unpaid; the cost per first post is unknown (CPO note 3) | Capped here: 1 retry per step, 3 Other angles per workspace. The real fix is a credit policy (monetization) |
| PipelineTab swallows thrown action errors (`PipelineTab.tsx:592-594, 614-616`) | Gate refusals are silent today, the same class of bug as W2 | Fixed here for the two publish paths; the rest is 0.5 d |
| The scheduler requires `isDefault: true` (`social-scheduler.service.ts:130`) | If a first connection is not marked default, publishing fails with NO_CONNECTION | Verify in QA. If it happens, set the default on first connect (API, ~10 lines) |

## 14. Open questions (CPO / Farjad)

- **Q1** Guided mode also requires "no enabled autopilot" (D1). Is that right, or should published posts be the only test?
- **Q2** After the first post, the concept puts Autopilot first and the Narrative second. But `tabGate.autopilot` (a UI gate, not a server gate) requires a narrative first. I keep the gate and show Narrative first when it applies (§5). The other option is to drop narrative from the UI gate once a post is published. Which?
- **Q3** The "AI calls / AI tokens / est. cost" stat chips are customer-facing telemetry, the same class as W3. Hide them for everyone, or only in guided mode (as specced)?
- **Q4** `CHANNEL_CONNECTED` is logged at finalize rather than on the landing (§7). OK for head-of-data's queries?
- **Q5** "Other angle" is capped at 3 per workspace at 0 credits. Is a cap acceptable before the credit policy exists?

## 15. CPO answers (23 Nov)

- **Q1** Yes: guided mode also requires no enabled autopilot.
- **Q2** Keep `tabGate.autopilot` as it is; the bar shows Narrative first when it applies.
- **Q3** Hide the "AI calls / AI tokens / est. cost" chips (and "tracked modules only") **for everyone**. They are customer-facing telemetry, the same class as W3; admins have the console.
- **Q4** OK: `CHANNEL_CONNECTED` at finalize.
- **Q5** OK: 1 retry per step, 3 Other angles per workspace, until a credit policy exists.
- **Real publish in QA**: publishing goes to a real LinkedIn profile. QA drives everything up to "Publish now" on its own; the final click on a real account waits for Farjad's explicit go in the session.
