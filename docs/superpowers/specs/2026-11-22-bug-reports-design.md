# Bug reports: one sentence from the user, the evidence from our logs

Status: spec, awaiting Farjad's go. Date: 2026-11-22. Owner: contivo-cto.

## Problem
22 Nov: matrices failed for a customer with "Something went wrong". The true cause
(OpenAI out of credit) sat only in the production DB. Mentee teams start now; their
reports will be vague. The report must carry the evidence itself.

## What already exists (verified in code, 22 Nov)
| Piece | State |
|---|---|
| Sentry | server only (`instrumentation.ts`, `onRequestError`); no browser SDK on purpose (82 kB); `global-error.tsx` shows the digest but reports nothing |
| `error.tsx` boundaries | none under `[locale]`; only `global-error.tsx` |
| Failure rows | `discovery_runs.error`, `matrix_runs.error` (coded via `competitors/run-errors.ts`), `SocialPublishLog`, `ai_provider_events` (class, status, message, workspace, user) |
| `activity_logs` | `user_id`, `workspace_id`, `action`, `detail`; `SESSION_STARTED`, `STEP_VIEWED` already written |
| Masking | `getMatrixStatus` maps stored cause to a few `errorKind`s; anything else (incl. provider out of credit) falls to `generic`. The cause is stored, the user and we never see the link |
| Request IDs | none. Server actions return `{ error: friendlyText }` with no reference |
| `rate-limit.ts` | Postgres fixed window, fails open |

So the cause is usually already in the DB. What is missing is **a key that joins a user's
complaint to it**, and a place to read it.

## Design

### 1. Reference ID
`CTV-` + 4 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L). Per-request, generated in a
tiny `withRef()` wrapper used by server actions and an `error.tsx`/`global-error.tsx`.
Collision handling: unique column, retry on conflict. 4 chars = 1M codes; fine for this volume,
widen to 5 if ever needed.
- The ref goes into: Sentry tag `ref`, `console.error` line prefix, `activity_logs.detail.ref`
  of a new `ACTION_FAILED` event, and `ai_provider_events` via the existing `workspaceId/userId`
  plus a new nullable `ref` in the report context (not a new column on that table, to keep the
  AI-failover stream untouched).
- **Coded cause, never a secret:** `ACTION_FAILED` stores `{ ref, action, code, status? }`, where
  `code` is from a closed list (`OUT_OF_CREDITS_PROVIDER`, `PROVIDER_TIMEOUT`, `RATE_LIMITED`,
  `AUTH_EXPIRED`, `VALIDATION`, `UNKNOWN`...), derived by one `classifyCause(error)` that reuses
  `classifyRunError` and the AI error classes. Free text from upstream is dropped.
- Failed action result becomes `{ error, ref }`; UI shows "Ref CTV-7F3K  Report this".
- Friendly text stays friendly. The cause moves to the log, linked by the ref.

### 2. Report a problem
Button in `app-shell.tsx` (top bar on desktop, bottom bar overflow on phone, always reachable).
Sheet: one optional textarea (max 1000 chars) + Send. After sending: "We got it. Ref CTV-…".
"Report this" from an error screen pre-attaches that ref (and its coded cause).
Locales en, fa, it, es, he written natively (fa via persian-writing standard). fr/ar/zh are site-only.

### 3. Context captured (all capped and redacted)
Client (browser, in memory only, nothing sent until the user presses Send):
ring buffer of the last 20 breadcrumbs (route changes, action names, failed actions with code+ref)
and last 10 console errors / unhandled rejections (message truncated to 200 chars, URLs stripped
to path, anything matching token/key/cookie patterns dropped), route, locale, viewport,
UA family, timestamp.
Server (built at submit time from the DB, never trusted from the client): user id, workspace id,
app version (`RAILWAY_GIT_COMMIT_SHA`), last 5 failed runs of the workspace (discovery, matrix,
publish) with their stored codes, last 10 `ai_provider_events` for the workspace, last 20
`activity_logs` of the user (action + coded detail only), the viewed object ids, the Sentry event id
when the failed action captured one.
Excluded: tokens, cookies, env, draft text, brand memory, free-text upstream messages. IDs and codes only.
Hard cap 32 kB per report, enforced server-side by dropping oldest list items.
Opt-in attach of text is **not in v1**.

### 4. Storage
Table `bug_reports` (additive migration `20261123090000_bug_reports`):
`id`, `referenceCode` unique, `userId` nullable FK **ON DELETE SET NULL**, `workspaceId` nullable
FK SET NULL, `message`, `locale`, `route`, `appVersion`, `context` Json, `status`
(`NEW|SEEN|FIXED|WONTFIX`), `fingerprint`, `createdAt`, `resolvedAt`; indexes `(status, createdAt)`,
`(fingerprint)`. Lesson from `activity_logs`: `message` and `context` are personal-ish, so user
deletion **nulls the link and a purge removes the message**: a deletion hook clears `message`
and `context` for that user's rows, and a 90-day retention purge (cron, existing `cron` module)
deletes old rows. Privacy page gets one sentence (legal via contivo-coo, not in my scope to word).
Fingerprint = hash of (top failed-cause code, failing action or run type, route pattern),
so ten users with out-of-credit OpenAI group into one row.

### 5. Admin "Reports"
`/admin/reports`: list grouped by fingerprint (count, last seen, status), detail with a readable
timeline (breadcrumbs, failed runs, provider events, activity) merged by time, links to user,
workspace, run and Sentry event, status buttons (server action behind `requireAdmin`). User text
rendered as plain text by React (no `dangerouslySetInnerHTML`); tested.

### 6. Finding out fast
Unseen-count badge on the admin nav in v1 (one query). **Telegram:** ContivoAppBot is live, but its
chat id is a secret and a ping per report is noise during a cohort. Recommend: v2, one digest
message per new *fingerprint* (not per report), only after Farjad says yes. Not built now.

### 7. Public "Having trouble?" form
Recommend **v2**, not v1. It is the only unauthenticated write endpoint (spam target) and it sits
on the sign-in pages another session is editing. Mentees can currently sign in; people who cannot
are reachable by email. When built: rate limit via `rate-limit.ts` per IP, honeypot, optional
email only, no context capture.

### 8. Triage script
`apps/api/scripts/reports-summary.ts`, read-only: counts per fingerprint and status, cause codes,
masked ids (`usr_…3f9a`). v1.5 (small, follow-up PR) so v1 stays reviewable.

## Options considered
| Option | Trade-off | Verdict |
|---|---|---|
| A. Sentry user-feedback widget only | needs browser SDK (82 kB everywhere), no join to run rows | no |
| B. Our own table + server-built context (this spec) | one migration, we own redaction, joins to our logs | **pick** |
| C. Email-a-report link | no structure, nothing joined | no |
| Context from client vs server | client can lie and leaks more | server builds, client sends only breadcrumbs/console |

## v1 (one PR)
Ref + coded `ACTION_FAILED` + `error.tsx`/`global-error.tsx` ref display and "Report this",
button + sheet + 5 locales, `bug_reports` migration + retention purge + deletion hook, server
context builder with redaction/caps, admin list + detail + status + unseen badge, tests (round trip,
redaction, caps, rate limit on submit, failed matrix run names real cause, RTL), and a live proof.
**Follow-ups:** triage script, Telegram digest, public form, opt-in text attach, console buffer polish.

## Rate limit on submit
10 reports/hour/user via `rate-limit.ts`; also dedupe the same ref.

## Risks
- `ref` threading touches many actions. v1 wraps only the highest-value ones (matrices, discovery,
  publish, content generation, autopilot start) plus the error boundaries; the rest fall through
  to the boundary ref.
- Shared files (`app-shell.tsx`, `global-error.tsx`, admin page): one-line mounts; no edits to
  `actions/auth.ts` or sign-in pages.
- Migration date follows PR #52's; the release manager runs it before the web deploy.

## Decisions for Farjad
1. Go on v1 as scoped?  2. Telegram digest and public form in v2: agree?
