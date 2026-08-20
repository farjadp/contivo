# Contivo — session handoff (19 August 2026)

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

## 🟢 It is deployed

| | URL | Host |
|---|---|---|
| Web | https://www.contivo.app | Vercel (`ashavidproject/contivo`) |
| API | https://contivo-api-production.up.railway.app | Railway (`contivo-api`) + Redis |
| DB | Neon — **schema `contivo`, not `public`** | |

Verified live: pages 200; both crons 401 unauthorised / 200 authorised;
Content API 401 without a key; API health ok with DB up; OAuth connect 401
without a signed handoff and callback 400 on a forged state.

### Do these first, in this order
1. **Register the redirect URI in the LinkedIn developer portal:**
   `https://contivo-api-production.up.railway.app/api/v1/social/oauth/linkedin/callback`
   Without it, connecting an account in production fails with
   `redirect_uri mismatch` and the loop cannot run there. Only Farjad can do this.
2. **Rebuild the workspace in production.** Its database is empty — workspace,
   brand memory, competitors, matrices, keywords, agents and the LinkedIn
   connection all exist only on the laptop.
3. Expect to log in again: `JWT_SECRET` was rotated, invalidating all sessions.

### Deploy quirks (each one cost a failed build)
- `NODE_ENV=production` makes pnpm skip devDependencies, but `typescript` and
  `@contivo/config` are devDeps the build needs → build with `--prod=false`.
- `.npmrc` sets `node-linker=hoisted` for Vercel, which **copies** workspace
  packages at install time, before `@contivo/types` is built → the API cannot
  resolve its `dist`. The Railway build overrides with
  `--config.node-linker=isolated`.
- Any `information_schema` query filtered on `public` will wrongly report the
  production tables missing. They live in the `contivo` schema.

---

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 · Foundation | ✅ | CI, typecheck, lint all green across 5 packages |
| 1 · Autopilot v1 | ✅ | Policy → runner → quality gate → real publish, with image + humanised copy |
| 2 · Website channel | ✅ | Content API, hashed site keys, blog publisher, Sites UI |
| 3 · Agents | ✅ | Several named agents per workspace, from recipes, each with its own quota |
| 4 · Monetise | ⏳ | Billing is an empty TODO; token crypto still XOR |
| Deploy | ✅ | Web + API live, schema migrated, secrets set |

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
9. **`JWT_SECRET` was unset in production** while the repo is public, so session
   signing fell back to a hardcoded default anyone could read — forging an ADMIN
   session was trivial. Now set to a random secret.
10. **The API `start` script pointed at `dist/main`** while `nest build` emits
    `dist/src/main.js`. The API could not start on any host, only in watch mode.

---

## Open work, highest value first

1. **Finish the production loop** — LinkedIn redirect URI, then rebuild the
   workspace and agents at www.contivo.app.
2. **Phase 4 — billing**: `BillingModule` is an empty TODO. `Subscription`,
   `CreditLedger`, `CreditsService` exist; nothing charges.
3. **Replace XOR token encryption** with AES-GCM/KMS. Its round-trip was broken
   until this session, which tells you how untested it is.
4. **Tests** — still zero across ~32k lines. Start with the AI normalisers and
   `lib/autopilot/schedule.ts` (pure, easy, high value).
5. **Strategic Reports on serverless** — Puppeteer + writing into
   `public/reports/` cannot work on Vercel.
6. **Redesign pass 2** — inner tab bodies still use the old rounded blue style.
7. **Nest API guard vs cookie auth** — every other API route is still
   unreachable from the browser for the same reason OAuth was.
8. **Alerting** — nothing notices when a provider fails 100% of calls or the
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
