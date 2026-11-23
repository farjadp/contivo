# First post, Concept B: implementation plan

contivo-cto · 23 Nov 2026 · spec: `docs/superpowers/specs/2026-11-23-first-post-b-design.md` · integration branch `myca/first-post-b` (from origin/main `61dcb40`)

Rules for every task: TDD (write the failing test first, `pnpm --filter web test <file>`), TypeScript, functional React, Tailwind only, no hardcoded config (`FIRST_POST_GUIDED` is read in one place), errors returned as values from server actions. Each task works in its own worktree `.claude/worktrees/first-post-b-<task>` on branch `myca/first-post-b-<task>`, cut from `myca/first-post-b` after T1 is merged into it. The CTO merges the task branches into `myca/first-post-b`. Nobody pushes; contivo-release-manager opens the PR.

**No file appears in two tasks.** Paths are under `apps/web/src/` unless stated.

## Order

```
T1 contracts + pure core (0.5 d)
   ├── T2 run orchestration (backend A, 1.5 d)
   ├── T3 publish-now + W2 + event helpers (backend B, 0.75 d)
   ├── T4 first-post view + pipeline W2 UI + W3/W4 (frontend A, 1.5 d)
   └── T5 bar + hiding + page wiring (frontend B, 1.25 d)
T6 QA, driven on the running app (0.75 d)  ← after T2–T5 are merged
T7 security review (0.25 d)                ← in parallel with T6
X  head-of-data (cross-group, via contivo-cpo): default-axes quality + AI cost per first post
```

Total ≈ 6.5 engineer-days, about 3 elapsed days with the four tasks in parallel. Size M, as concepts.md estimated.

---

## T1. Contracts and pure core (contivo-backend-developer)

Goal: every type and pure function the other tasks import, so T2–T5 can build in parallel against it.

Files:
- `lib/first-post/types.ts` (new): `FirstPostStep`, `FirstPostState`, `StepResult`, `FirstPostErrorKind` (closed enum: `timedOut`, `dispatch`, `notEnoughEvidence`, `notEnoughAxes`, `aiUnavailable`, `notEnoughCompetitorSignals`, `generic`), `LinkedInState`, `NextStepId`, `NextStepSurface`, `NextStep`, `FirstPostViewProps`, plus the activity action names as `const` strings.
- `lib/first-post/state.ts` (new) + `state.test.ts`: `deriveFirstPostState(rows, facts, now)`.
- `lib/first-post/mode.ts` (new) + `mode.test.ts`: `isGuidedMode({ publishedAnywhere, autopilotEnabledAnywhere, env })` (pure) and `loadGuidedMode(userId)` (2 counts).
- `lib/next-step.ts` (new) + `next-step.test.ts`: `buildNextStep(input)`.
- `lib/workspace-journey.ts` + `workspace-journey.test.ts` (existing test file, or create it if missing): `firstPost` end step.
- `lib/connect-return.ts` + `connect-return.test.ts`: `connectedNextAction(workspaceId, journey, publishedCount, firstPostDraftId | null)` adds the kind `{ kind: 'firstPostDraft', href: '/growth/<id>?tab=first-post' }`.

Tests first:
- state: confirm with 0 rows; running → current step; STEP_FAILED → failed with `retriesLeft` 1, then 0 after a second failure of the same step; 15-min silence → `timedOut`; FINISHED → draft; item SCHEDULED → publishing; PUBLISHED → published with the URL; FINISHED pointing at a deleted item → confirm.
- mode: published > 0 → open; autopilot on → open; env `off` → open; otherwise guided.
- next-step: one case per row of spec §5 table, plus a word count ≤ 20 on the en catalogue (reads `messages/en/workspace.json` once the T5 keys exist; until then the test uses key names only).
- journey: `steps.length === 7`, `total === 6`, percent/isComplete/next unchanged on every existing fixture; `firstPost.done` follows `publishedCount`.
- connect-return: the existing cases are unchanged when `firstPostDraftId` is null; with a draft id → `firstPostDraft`.

Done: `pnpm --filter web test` and `pnpm --filter web exec tsc --noEmit` green; merged into `myca/first-post-b` before T2–T5 branch off.

## T2. Run orchestration (contivo-backend-developer A)

Files:
- `lib/matrices/pipeline.ts` + `pipeline.test.ts`: `runMatrixPipeline(runId, { autoAxes? })`, branch at `:250-268`. (Overlaps draft PR #30's model-literal hunk; tell the release manager.)
- `lib/matrices/start-run.ts` (new) + `start-run.test.ts`: `createMatrixRunRow(owned)`, `dispatchMatrixRun(run)`.
- `app/actions/growth-matrices.ts`: `startRun` delegates to the two functions above; `growth-matrices.test.ts` is unchanged and green.
- `lib/competitor-keywords/generate.ts` (new) + `generate.test.ts`: everything from `app/actions/growth-keywords.ts:3-707`, as `generateCompetitorKeywordsCore(actor)`.
- `app/actions/growth-keywords.ts`: thin wrapper; `growth-keywords.test.ts` is unchanged and green (update only the mock paths if the module moved).
- `lib/first-post/run-log.ts` (new) + `run-log.test.ts`: `insertRunStarted` (deterministic id, P2002 → `alreadyRunning`), `writeStepRow`, `readRunRows(workspaceId)`.
- `lib/first-post/run.ts` (new) + `run.test.ts`: `runFirstPost(runId)`, `runIdeaAndDraft(actor, avoidTopics)`.
- `app/api/first-post/run/route.ts` (new) + `route.test.ts`: copy of the matrices route's auth (`api/matrices/run/route.ts:33-60`).
- `app/actions/first-post.ts` (new) + `first-post.test.ts`: `startFirstPost`, `getFirstPostState`, `firstPostOtherAngle`.
- `messages/{en,fa,it,es,he}/errors.json`: new keys `firstPostAlreadyRunning`, `firstPostDispatchFailed`, `firstPostOtherAngleLimit`.

Tests first:
- pipeline: autoAxes 2 with 4 candidates → 2 stored, run DONE with 4 charts, no NEEDS_AXES; 0 candidates → 2 charts and DONE (the gate fails later, in run.ts); no option → NEEDS_AXES exactly as today.
- run: all four steps called in order with the spec's options (`requestedIdeaCount: 1`, `autoInsertToCalendar: false`, `includeImages: false`, `platform: 'linkedin'`); matrices skipped when the gate is ok; keywords skipped when present; a keywords failure writes STEP_FAILED with `notEnoughCompetitorSignals` and stops; the retry skips done steps; `chargeCredits` is never called; `loadIdeationContext` is not mocked away in one integration-style test, so the real gate runs on fixture data.
- route: 401 without or with a wrong secret, 401 when `CRON_SECRET` is unset, 202 + `after` called with the right id, unknown id → nothing runs.
- actions: unauthenticated → error; someone else's workspace → `workspaceNotFound`; < 2 accepted → `needTwoReviewed`; a double start → the second gets `alreadyRunning` (P2002); dispatch failure → a STEP_FAILED `dispatch` row; Other angle passes previous topics as `steeringNotes` and stops at 3.

Done: tests + tsc green. A local run on a fresh workspace (DB :5433) produces the rows in spec §7 and a GENERATED item. Paste the SQL listing into the hand-off.

## T3. Publish now, W2, event helpers (contivo-backend-developer B)

Files:
- `lib/publish-readiness.ts` (new) + `publish-readiness.test.ts`: `assertPublishTarget(workspaceId, channel)` → `{ ok: true } | { ok: false; reason: 'no_connection'; platform }`.
- `app/actions/publish-now.ts` (new) + `publish-now.test.ts`: `publishNow(contentId, { override? })`, `schedulePublish(payload)` (result-returning twin of `scheduleContentItem`), `getPublishProgress(contentId)` (item + latest job → `resolvePublishOutcome`).
- `app/actions/calendar.ts` + `calendar.test.ts`: `scheduleContentItem` and the scheduling branch of `updateContentAndSchedule` call `assertPublishTarget`. They refuse without scheduling (scheduleContentItem throws a coded error for compatibility; updateContentAndSchedule saves the text but holds the schedule and returns `held: 'no_connection'`).
- `lib/step-view.ts` (new) + `step-view.test.ts`: `logStepView(userId, tab, workspaceId?)`, never throws, closed tab list.
- `app/actions/next-step.ts` (new) + `next-step.test.ts`: `recordNextStepClick(stepId, surface)`, enum-checked.
- `app/actions/social-connect.ts` + `social-connect.test.ts`: `CHANNEL_CONNECT_STARTED` on a successful URL.

Tests first: no connection → nothing written to `content_items` and `{ ok: false, reason: 'no_connection' }`; connected default → SCHEDULED with `scheduledAtUtc` within 1 s of now; blocked verdict → `quality_gate_blocked` result; override → passes and is stamped; someone else's item → not found; blog with an active site → ok; progress maps PUBLISHED + job URL → `published` with a safe URL; `javascript:` URL → null; bad `stepId` → no row.

Done: tests + tsc green. Locally, with the API running (`:3001`) and a connected LinkedIn, publishNow publishes within 2 min. If no LinkedIn connect is possible locally, say so and mark it unverified.

## T4. First-post view, pipeline W2 UI, W3/W4 (contivo-frontend-developer A)

Files:
- `app/[locale]/(dashboard)/growth/[id]/_components/first-post/FirstPostView.tsx` (new; switches on `FirstPostState.phase`)
- `.../first-post/CompetitorConfirm.tsx`, `RunProgress.tsx`, `DraftCard.tsx`, `PublishPanel.tsx`, `PublishedCard.tsx` (new)
- `.../first-post/first-post-view-logic.ts` (new) + `first-post-view-logic.test.ts`: evidence line pick, tick rules, poll intervals, word budgets.
- `app/[locale]/(dashboard)/growth/[id]/_components/PipelineTab.tsx`: the two publish handlers (`:575-620`) use `schedulePublish` and show the no-connection notice with a Connect button; no other change.
- `app/[locale]/(dashboard)/growth/[id]/_components/CompetitorKeywordsTab.tsx`: remove `:182-230` (W3).
- `app/[locale]/(dashboard)/growth/[id]/_components/IdeationTab.tsx`: remove the score, fallback and calendar badges `:506-527` (W4).
- `messages/{en,fa,it,es,he}/tabs-a.json`: `tabsA.firstPost.*`, `tabsA.pipeline.noConnection*`; remove the now-unused W3/W4 keys from `tabsA`/`tabsB` only if they live in this file, otherwise leave them.

Tests first: logic tests (evidence host from `splitEvidence`, nothing pre-ticked except ACCEPTED rows, a manually added row arrives ticked, button enabled at ≥ 2, poll 3 s → 15 s after 3 min, published URL only via `safePostUrl`).

Done: screenshots of every phase in en and fa at 1280 and 375 px (fa RTL, Persian digits), driven on the running app by a signed-in human (memory: token minting is blocked), and `/impeccable audit` notes. Persian copy is written natively (memory: contivo-persian-copy); have contivo-ux-ui-designer check the fa strings via the CTO.

## T5. Bar, hiding, page wiring (contivo-frontend-developer B)

Files:
- `components/next-step/NextStepBar.tsx` (new, server) + `NextStepButton.tsx` (new, client; awaits `recordNextStepClick`, then navigates or starts the connect / publish-now action).
- `lib/next-step-load.ts` (new) + `next-step-load.test.ts`: `loadNextStepInput(userId, workspaceId | null, surface)`.
- `app/[locale]/(dashboard)/growth/[id]/page.tsx`: guided mode, the `first-post` tab in `resolveTab`, default tab, hide the §9 items, mount the bar and `FirstPostView`, `FIRST_DRAFT_SEEN`, the connected notice via the new `connectedNextAction` arg. (Overlaps draft PR #30's MODEL_RATES hunk.)
- `app/[locale]/(dashboard)/growth/[id]/_components/ChannelConnectedNotice.tsx`: one-line mode for the landing.
- `app/[locale]/(dashboard)/growth/[id]/_components/JourneyGuide.tsx`: skip `firstPost`.
- `app/[locale]/(dashboard)/dashboard/page.tsx`: bar, hide the loop/moves/cards in guided mode, `STEP_VIEWED today`, moves skip `firstPost`.
- `app/[locale]/(dashboard)/connections/page.tsx`: bar, `STEP_VIEWED connections`, `CHANNEL_CONNECTED` on finalize ok.
- `app/[locale]/(dashboard)/layout.tsx` + `components/layout/app-shell.tsx`: `hideInstant`.
- `app/[locale]/(onboarding)/onboarding/page.tsx`: guided → `STEP_VIEWED onboarding` + redirect `/growth/new`.
- `app/[locale]/(dashboard)/growth/new/page.tsx` → a server page (`STEP_VIEWED new`) rendering the moved client form `growth/new/_components/NewWorkspaceForm.tsx` (new; the content of today's page, unchanged).
- `app/[locale]/(dashboard)/growth/analyzing/_components/AnalyzingRunner.tsx`: drop the `tab` param (`:80`), so the page decides.
- `messages/{en,fa,it,es,he}/workspace.json`: `nextStep.*`, `connectedNotice.action.firstPostDraft` / `body.firstPostDraft`.

Tests first: `next-step-load` (picks the workspace, maps facts + state, open mode for published users); a render test of `NextStepBar` per state if the repo's vitest setup renders server components, otherwise logic-only.

Done: the same bar line on the workspace page, Today, Connections and `?connected=` (4 screenshots, en + fa). A published user's workspace page and Today match `61dcb40` apart from W3/W4 (screenshot pair). `node apps/web/scripts/check-i18n.mjs` green.

## T6. QA (contivo-qa-engineer)

Before the build: an acceptance matrix from spec §12 (16 criteria), saved to `.claude/agent-org/work/engineering/2026-11-23-first-post-b-qa.md`. After the merge into `myca/first-post-b`: drive the full walk on the local stack (web + API + Redis, DB :5433, the API's `WEB_APP_URL` = web port) on a fresh account in en and in fa. Time it against the 6m48s baseline, list the `activity_logs` rows, test the failure path by stopping the API key or forcing <2 signals, and run the kill switch. Report go/no-go, with verified and assumed listed separately.

## T7. Security review (contivo-security-engineer)

Scope: `app/api/first-post/run/route.ts`, `app/actions/{first-post,publish-now,next-step}.ts`, `lib/first-post/run-log.ts`. Checks: bearer handling, run-id spoofing, ownership on every action, enum validation of event input, no post text or URLs in logs.

## Exact list of files touched

New (25): `lib/first-post/{types,state,mode,run-log,run}.ts`, `lib/next-step.ts`, `lib/next-step-load.ts`, `lib/matrices/start-run.ts`, `lib/competitor-keywords/generate.ts`, `lib/publish-readiness.ts`, `lib/step-view.ts`, `app/api/first-post/run/route.ts`, `app/actions/{first-post,publish-now,next-step}.ts`, `components/next-step/{NextStepBar,NextStepButton}.tsx`, `growth/[id]/_components/first-post/{FirstPostView,CompetitorConfirm,RunProgress,DraftCard,PublishPanel,PublishedCard}.tsx`, `growth/[id]/_components/first-post/first-post-view-logic.ts`, `growth/new/_components/NewWorkspaceForm.tsx`. Each has its `.test.ts` where it holds logic.

Edited (19 + 15 catalogues): `lib/workspace-journey.ts`, `lib/connect-return.ts`, `lib/matrices/pipeline.ts`, `app/actions/{growth-matrices,growth-keywords,calendar,social-connect}.ts`, `growth/[id]/page.tsx`, `growth/[id]/_components/{ChannelConnectedNotice,JourneyGuide,PipelineTab,CompetitorKeywordsTab,IdeationTab}.tsx`, `dashboard/page.tsx`, `connections/page.tsx`, `(dashboard)/layout.tsx`, `components/layout/app-shell.tsx`, `(onboarding)/onboarding/page.tsx`, `growth/new/page.tsx`, `growth/analyzing/_components/AnalyzingRunner.tsx`; `messages/{en,fa,it,es,he}/{errors,tabs-a,workspace}.json`.

Not touched: `apps/api/**` (unless QA finds the `isDefault` issue, which then becomes its own task), `schema.prisma`, `i18n/request.ts`, `i18n/routing.ts`, `lib/report-readiness.ts` (`matricesGate`), `lib/content-engine.ts` (`loadIdeationContext`), `lib/quality-verdict*.ts`.

## Deploy hand-off (for Farjad, after merge; nothing to run now)

contivo-web only: `railway up` from a plain clone (memory: deploy runbook; a push to main ships nothing). No migration. No new required env var; the optional kill switch is `FIRST_POST_GUIDED=off`. contivo-api is not redeployed.
