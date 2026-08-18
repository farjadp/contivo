# Contivo — session handoff (18 August 2026)

Paste this at the start of the next chat. It is the shortest complete picture
of where the project stands, what is running, and what to be careful about.

---

## What Contivo is now

An AI marketing workspace that **actually publishes on its own**. Give it a
website URL; it builds brand memory and a competitive map, then named agents
ideate, draft, humanise, illustrate, quality-check and publish to LinkedIn and
to your own website on a schedule — with nobody in the loop.

**Proof it works:** a real unattended post went live on 18 Aug —
`https://www.linkedin.com/feed/update/urn:li:share:7495350777063075840`

---

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 · Foundation | ✅ | CI, typecheck, lint all green across 5 packages |
| 1 · Autopilot v1 | ✅ | Policy → runner → quality gate → real publish, with image + humanised copy |
| 2 · Website channel | ✅ | Content API, hashed site keys, blog publisher, Sites UI |
| 3 · Agents | ✅ | Several named agents per workspace, from recipes, each with its own quota |
| 4 · Monetise | ⏳ | Billing is an empty TODO; token crypto still XOR |

---

## Architecture in five sentences

1. pnpm/Turborepo monorepo: `apps/web` (Next.js 15) and `apps/api` (NestJS 10),
   Postgres via Prisma, BullMQ/Redis, Gemini + OpenAI.
2. **Most business logic lives in `apps/web/src/app/actions/*` as server
   actions**, not in the Nest API — do not assume otherwise.
3. `apps/web/src/lib/content-engine.ts` is the session-less core (ideate →
   pipeline item → draft → SCHEDULED); server actions are thin wrappers.
4. `apps/web/src/lib/autopilot/` holds the runner, slot picker, quality gate,
   recipes and channel map; `/api/autopilot/tick` is the cron entry point.
5. The Nest API owns social OAuth and publishing: `SocialSchedulerService`
   fires every minute, `publishDueWebContent` handles the website channel.

### Key files
- `lib/autopilot/runner.ts` — the whole autonomous loop
- `lib/autopilot/quality-gate.ts` — deterministic checks + AI judge, **fail-closed**
- `lib/autopilot/recipes.ts` — agent presets
- `lib/humanize.ts` — strips AI tells, expands thin drafts, keeps hashtags
- `lib/content-image.ts` — art direction + gpt-image-1, bytes in `content_images`
- `lib/workspace-journey.ts` — the dependency chain the UI renders
- `apps/api/src/modules/social/adapters/linkedin.adapter.ts` — text + image posts

---

## Local dev (this machine)

```bash
docker compose up -d                       # Postgres :5433, Redis :6379
cd apps/api && pnpm exec nest start        # API on :3001 — must stay 3001
# web: use preview_start with the "web" config (autoPort; 3000 is taken)
```

- **Postgres is on :5433**, not 5432 — another project holds 5432.
- The web dev server gets a **random port**. After it starts, set
  `WEB_APP_URL` in `apps/api/.env` to that port or OAuth returns to nowhere.
- Schema changes: `prisma db push` locally, and also write a migration file.
  The migrations directory is behind the live schema (baseline card exists).
- **After any schema change, restart the web dev server** — a stale Prisma
  client silently breaks new models (this bit twice: `contentImage`, `agentId`).

### Accounts
- `farjad@ashavid.ca` — ADMIN, workspace "Farjad Official website" (older)
- `its@farjadp.info` — the **live** workspace "Official web (ME)"
  (`cmsy49fxh00024y0mdna9jlza`), LinkedIn connected, agents running

### Test the loop
```bash
SEC=$(grep '^CRON_SECRET=' apps/web/.env.local | cut -d= -f2 | tr -d '"')
curl -s -X POST -H "Authorization: Bearer $SEC" \
  "http://localhost:<webport>/api/autopilot/tick?policyId=<agentId>"
```

---

## Bugs found and fixed this session (all were silent)

These are worth knowing because they show the failure pattern: **things that
looked like they worked, didn't.**

1. **Gemini default model was retired** — every Gemini call 404'd and silently
   fell back to OpenAI for months. Default is now `gemini-3.7-flash`.
2. **Social OAuth was unreachable** — both `/connect` and `/callback` sat behind
   a Clerk guard the web app cannot satisfy. No account could ever be connected.
3. **`decryptToken` was broken** — it decoded XOR ciphertext as UTF-8, corrupting
   every token. Publishing always failed as "token expired".
4. **Scheduler channel map** was keyed `LINKEDIN` while the enum stores
   `linkedin` — nothing was ever published.
5. **Publish never wrote back** to the content item, leaving it in `PUBLISHING`.
6. **app-settings limits collapsed to 1** when unset — ideation returned a
   single idea instead of ten.
7. **Competitor accept/reject was discarded** unless a separate "Save Manual
   Edits" button was pressed. Now saves on click.
8. **Expansion pressure caused fabrication** — the model invented a client case
   study ("churn dropped") and the judge scored it 9/10 for safety. Both the
   rewrite rule and the judge now treat that as fabrication.

---

## Open work, highest value first

1. **Phase 4 — billing**: `BillingModule` is an empty TODO. `Subscription`,
   `CreditLedger`, `CreditsService` exist; nothing charges.
2. **Replace XOR token encryption** with AES-GCM/KMS. Its round-trip was broken
   until today, which tells you how untested it is.
3. **Tests** — still zero across ~32k lines. Start with the AI normalisers and
   `lib/autopilot/schedule.ts` (pure, easy, high value).
4. **Strategic Reports on serverless** — Puppeteer + writing into
   `public/reports/` cannot work on Vercel.
5. **Redesign pass 2** — inner tab bodies still use the old rounded blue style.
6. **Nest API guard vs cookie auth** — every other API route is still
   unreachable from the browser for the same reason OAuth was.
7. **Alerting** — nothing notices when a provider fails 100% of calls or the
   publish cron dies. That is how bug #1 survived months.

Full backlog with priorities: **Contivo Mission Control** in Notion.

---

## Working agreements that paid off

- Verify against reality, not the code's intent — every bug above was found by
  driving the real thing end to end.
- The quality gate is fail-closed on purpose: if no AI provider answers, the
  post is **held**, never published unreviewed.
- Images and humanisation are best-effort; they must never block a publish.
- Don't let the model invent first-person client stories. It will, if pushed
  for length.
