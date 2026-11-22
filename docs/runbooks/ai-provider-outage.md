# Runbook: AI provider outage (OpenAI / Claude / Gemini)

Owner: contivo-mlops-engineer · Acts: **Farjad only** (agents never change env vars, keys or billing) ·
Spec: `docs/superpowers/specs/2026-11-22-ai-provider-failover-design.md` · Written 22 Nov 2026.

Every AI call in `apps/web` goes through `lib/ai/run.ts`, which walks a provider chain
(default OpenAI → Claude → Gemini; content tasks Gemini → OpenAI → Claude). When a provider fails,
the call moves to the next one. A failover is not an outage. It becomes one when (a) a provider stays
down for a reason only you can fix (billing, key, model), or (b) every provider in a chain fails.

> Names below (`AI_CHAIN_<TASK>`, task ids, event types) follow the spec. Before relying on one in an
> incident, check `apps/web/src/lib/ai/chains.ts` on the deployed commit.

---

## 1. How an outage shows up

| Where | What you see |
|---|---|
| **Email from Sentry** (rule in §7) | Issue titled with the provider and class, level `fatal`, tags `ai.provider`, `ai.task`, `ai.error_class`. One issue per `[provider, errorClass]`, so a whole outage is one issue, not thousands. "AI fully unavailable" (`fatal`) = every provider in a chain failed. |
| **Admin → "AI providers" card** (https://www.contivo.app/en/admin) | Per provider: configured / healthy / cooling down until `<time>`, last error class and time, failovers per task in the last 24 h. |
| **`ai_provider_events` table** | One row per failed attempt (`eventType = attempt_failed`), per health change (`health_changed`), per full outage (`all_unavailable`). Queries in §4. |
| **Railway logs** (`railway logs --service contivo-web`) | One line per switch: `[ai] openai billing → anthropic for competitor_judge`. Before this feature nothing was logged at all. |
| **Customers** | Only when the whole chain fails: "The AI service is unavailable right now. We've been alerted and are fixing it. Your work is saved." (fa: «سرویس هوش مصنوعی الان در دسترس نیست…»). They never see "wait a few minutes" for billing or auth. |

## 2. What each error class means

| Class | Meaning | Fixes itself? | Severity | Health effect |
|---|---|---|---|---|
| `billing` | Out of credit, spend cap or spend limit hit, payment failed. OpenAI 429 `insufficient_quota` / `credit_balance_exhausted` / `*_spend_limit_exceeded`; Anthropic 400 "credit balance is too low", 400 "reached your specified API usage limits", 429 `enforced_spend_limit_reached`, 402; Gemini 402, 403 outstanding balance, 400 `FAILED_PRECONDITION`, 429 daily quota | **No.** Waiting does not help; Anthropic's tier cap lasts until the 1st of next month | fatal | provider skipped 15 min, then re-probed |
| `auth` | Key missing, revoked, wrong, or no permission. OpenAI 401; Anthropic 401/403; **Gemini 400 `API_KEY_INVALID`** and 403 | **No** | fatal | skipped 15 min |
| `model_gone` | Model retired or renamed (404). Retirements on the calendar: `gpt-image-1` shut down 23 Oct 2026, `gpt-5-mini` (competitor web search) 11 Dec 2026, `gpt-4.1` 14 Jan 2027 | **No** | fatal | skipped 15 min |
| `rate_limit` | Too many requests per minute | Yes, in seconds | warning | cool-down = `retry-after`, max 60 s |
| `overloaded` / `server` | Provider 5xx, Anthropic 529 | Usually, in minutes | warning | 30 s cool-down after 3 in a row |
| `timeout` / `network` | No answer in time, connection failed | Usually | warning | 30 s after 3 in a row |
| `bad_request` | Our request is malformed: **our bug**. No failover | No: needs a code fix | error | none |
| `invalid_output` | Answer was empty or unparseable; retried once, then next provider | Usually | warning | none |
| `refusal` | Model declined the content. No failover | n/a: content problem | warning | none |

Rule of thumb: **fatal = you have to do something. warning = watch it; act only if it lasts > 30 min or
customers see "unavailable".**

## 3. What to do, per class

Read the Sentry issue or the §4 summary first: which **provider**, which **class**, since when.

### 3.1 `billing`
1. Open that provider's billing page (§6) and add credit, or raise the spend limit / cap that was hit.
2. Turn on auto-recharge if it is off (§6), with a monthly cap you are comfortable with.
3. Nothing to redeploy. The provider is re-probed within 15 min; to see it sooner, run one real request (§5).
4. If you cannot top up now (card declined, Anthropic tier cap until month end), disable the provider so
   every call stops paying a round trip on it: set `AI_PROVIDER_DISABLED=<provider>` (§3.5). Remove it afterwards.

### 3.2 `auth`
1. Create a new key on the provider's key page (§6).
2. Railway → project `contivo-api` → service **`contivo-web`** → Variables → update the key
   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`) → Deploy the staged change.
   CLI equivalent (redeploys contivo-web):
   ```bash
   cd /Users/farjad/Downloads/Work-Studio/Contivo
   railway variables --service contivo-web --set "OPENAI_API_KEY=<paste new key>"
   ```
   Keys go on **contivo-web** only; `apps/api` makes no AI calls.
3. Revoke the old key on the provider page **after** recovery is confirmed (§5).
4. Never paste a key into chat, Notion, a commit or a file in this repo (the repo is public).

### 3.3 `model_gone`
1. Find the replacement on the provider's deprecation page
   (OpenAI: https://developers.openai.com/api/docs/deprecations). Ask contivo-cto to confirm it handles
   our prompts before switching; a renamed model can change output quality.
2. Where the model is set:

   | Calls | Setting |
   |---|---|
   | Gemini primary + OpenAI fallback for content, drafts, website analysis, quality gate (`lib/gemini.ts`) | Admin → AI settings: "Gemini primary model", "OpenAI fallback model" (no deploy). Env `GEMINI_MODEL`, if set, overrides the admin value |
   | Other OpenAI calls (judge, matrices, queries, brand assets, keywords, offerings) | env `OPENAI_DEFAULT_MODEL` on contivo-web (today `gpt-4.1`) |
   | Competitor web search | env `OPENAI_SEARCH_MODEL` (not set in prod; code default `gpt-5-mini`, **shuts down 11 Dec 2026**) |
   | Images | hardcoded `gpt-image-1` in `lib/content-image.ts` (**past its 23 Oct 2026 shutdown**): needs a code change |
   | Claude | env `ANTHROPIC_MODEL_JUDGE` (judge, matrices, quality gate), `ANTHROPIC_MODEL` (everything else) |

3. Env changes redeploy contivo-web (same steps as §3.2).

### 3.4 `rate_limit`, `overloaded`, `server`, `timeout`
1. Check the provider status page (§6). Failover is already carrying the traffic.
2. If it lasts > 30 min and the next provider in the chain is weaker for a task (for example Gemini for
   competitor web search), move a better provider forward for that task (§3.5).
3. Recurring per-minute `rate_limit` on a healthy day means our usage outgrew the tier: request a
   higher limit (Anthropic: https://platform.claude.com/usage/limits; OpenAI: https://platform.openai.com/settings/organization/limits).

### 3.5 Overrides (env on contivo-web, each change redeploys)
- `AI_PROVIDER_DISABLED=gemini` (comma list, e.g. `openai,gemini`): skip a provider everywhere.
- `AI_CHAIN_<TASK>=anthropic,openai`: order for one task. `<TASK>` is the task id upper-cased, e.g.
  `AI_CHAIN_COMPETITOR_JUDGE`, `AI_CHAIN_COMPETITOR_WEB_SEARCH`. Provider ids: `openai`, `anthropic`, `gemini`.
- **Remove every override once the incident is over.** A forgotten override is the silent failure this
  system exists to prevent. Write it in the Notion incident note with the date to remove it.

### 3.6 `bad_request` spike
Not a provider problem. Hand the Sentry issue to contivo-cto; do not change keys or chains.

## 4. SQL: the last 24 h

Run in the Neon SQL editor for the project with compute endpoint `ep-snowy-band-a42asdqr`,
or any psql session on the production `DATABASE_URL`. Read-only. Tables live in schema **`contivo`**.

```sql
SET search_path TO contivo;

-- 1. Summary: who failed, why, since when, where traffic went
SELECT provider, "errorClass", "eventType", count(*) AS events,
       min("createdAt") AS first_seen, max("createdAt") AS last_seen,
       string_agg(DISTINCT task, ', ') AS tasks,
       string_agg(DISTINCT coalesce("failedOverTo", '-'), ', ') AS failed_over_to
FROM ai_provider_events
WHERE "createdAt" > now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY last_seen DESC;

-- 2. Latest 50 events with the sanitised provider message
SELECT "createdAt", provider, task, "errorClass", status, "failedOverTo", "eventType",
       left(message, 160) AS message
FROM ai_provider_events
WHERE "createdAt" > now() - interval '24 hours'
ORDER BY "createdAt" DESC
LIMIT 50;

-- 3. Full outages (customers saw "unavailable")
SELECT "createdAt", task, "workspaceId", left(message, 200) AS message
FROM ai_provider_events
WHERE "eventType" = 'all_unavailable'
  AND "createdAt" > now() - interval '24 hours'
ORDER BY "createdAt" DESC;

-- 4. Shape over time (when did it start / stop)
SELECT date_trunc('hour', "createdAt") AS hour, provider, "errorClass", count(*)
FROM ai_provider_events
WHERE "createdAt" > now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;
```

All four queries were run against the local dev DB (schema `public`, same table) on 22 Nov 2026 and
parse and execute (0 rows locally).

## 5. Confirming recovery

The provider is back when **all** of these hold:
1. Admin "AI providers" card shows it **healthy** (no "cooling down until").
2. `ai_provider_events` has a `health_changed` row for it after your fix, and no new `attempt_failed` rows for
   it since:
   ```sql
   SET search_path TO contivo;
   SELECT "createdAt", "eventType", "errorClass", task FROM ai_provider_events
   WHERE provider = 'openai' AND "createdAt" > now() - interval '2 hours'
   ORDER BY "createdAt" DESC LIMIT 20;
   ```
3. It answers real traffic again: successful calls in `ai_usage_logs` with that provider:
   ```sql
   SET search_path TO contivo;
   SELECT provider, max("createdAt") AS last_success, count(*) AS calls_last_hour,
          round(sum(coalesce("estimatedCostUsd", 0))::numeric, 4) AS cost_usd_last_hour
   FROM ai_usage_logs
   WHERE "createdAt" > now() - interval '1 hour'
   GROUP BY provider
   ORDER BY last_success DESC;
   ```
   No traffic yet? Make one real request yourself in your own workspace: a content draft (Gemini-first
   chain) or "Find competitors" (OpenAI-first chain). The first call after the cool-down is the probe.
4. **Resolve the Sentry issue.** If the provider breaks again, the issue regresses and the alert fires again.
   An unresolved issue only re-alerts according to the rule's throttle.
5. Remove any `AI_PROVIDER_DISABLED` / `AI_CHAIN_*` override you set, and revoke an old key if you rotated one.

## 6. Provider pages

Billing pages with auto-recharge. Set auto-recharge on all three with a monthly cap; the 22 Nov outage was an
OpenAI org at $0 with nobody told.

| Provider | Billing + auto-recharge | Spend limits | API keys | Status |
|---|---|---|---|---|
| OpenAI | https://platform.openai.com/settings/organization/billing/overview: "Auto recharge" (threshold + amount, optional monthly limit, $5 minimum). Help: https://help.openai.com/en/articles/8264644 | https://platform.openai.com/settings/organization/limits | https://platform.openai.com/settings/organization/api-keys | https://status.openai.com |
| Anthropic (Claude Console) | https://platform.claude.com/settings/billing: Credit balance → "Set up auto-reload" / "Manage auto-reload" (Admin or Billing role) | https://platform.claude.com/settings/spend-limits · tier and caps: https://platform.claude.com/usage/limits | https://platform.claude.com/settings/keys | https://status.claude.com |
| Google (Gemini) | https://aistudio.google.com/billing: "Available credits" card → "Setup auto-reload" / "Manage auto-reload" (monthly limit inside). Postpaid accounts: https://console.cloud.google.com/billing/ | https://aistudio.google.com/spend ("Monthly spend cap") · usage: https://aistudio.google.com/usage | https://aistudio.google.com/apikey | https://aistudio.google.com/status |

URL verification (22 Nov): the platform.claude.com paths return HTTP 200 while a made-up path on the same host
returns 404, so they are real routes. platform.openai.com and aistudio.google.com return 200 for **any** path
(single-page apps), so those URLs come from the providers' docs and help pages and are not proven by the HTTP check.
None was opened signed in. If one has moved, the billing link in each console's left nav is the fallback.

## 7. Sentry alert rules (suggested, to set up in Sentry)

Sentry → Alerts → Create Alert → **Issues** → project for contivo-web:

**Rule A: "AI provider needs Farjad" (the important one)**
- WHEN: *A new issue is created* **or** *A resolved issue regresses* **or** *An event or issue activity is captured*
- IF (all):
  - *The event's level* **equals** `fatal`
  - *The event's tag* `ai.error_class` **is one of** `billing,auth,model_gone`
- THEN: *Notify on preferred channel* → Member → Farjad (email)
- Throttling: **60 minutes** (one email per hour while it is still broken; without the third trigger a long
  outage on one unresolved issue would email once and then go quiet)

**Rule B: "AI fully unavailable"**
- WHEN: same three triggers
- IF: *The event's level* **equals** `fatal` **and** *The event's tag* `ai.task` **is set**, *and the message contains* `AI fully unavailable`
- THEN: email Farjad · Throttling **30 minutes**

**Rule C (optional): failover noise**
- WHEN: *An event or issue activity is captured*
- IF: level **equals** `warning` and tag `ai.provider` **is set**
- THEN: email · Throttling **24 hours** (a daily nudge that a provider is flaky, not a page)

Test after creating: Sentry's "Send test notification" on each rule. A real end-to-end test is the spec's
dev-only `AI_FORCE_FAIL=openai:billing` on a local run, with `SENTRY_DSN` set locally; it is ignored in
production by design.

## 8. After the incident

Add a line to the Notion incident log: start, end (from §4 query 4), provider, class, customer impact
(rows from §4 query 3), what you changed, overrides set and removed. If a fixture in
`apps/web/src/lib/ai/__fixtures__` was built from docs rather than a recording, replace it with the real
`message` from `ai_provider_events`.
