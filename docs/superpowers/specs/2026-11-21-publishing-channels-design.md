# Publishing channels: Telegram, WordPress, X, Threads — design

Status: **approved by Farjad 2026-11-21**: recommended order (core → Telegram → X → WordPress → Threads), X pay-per-use with a $75/month cap, no links in X posts by default. WordPress = Contivo pull plugin (§4). Open: WordPress default status, bot username, Meta Business Verification start. Author: contivo-cto, 2026-11-21.
Base: `origin/main` 9df407f. Branch: `myca/channels-211611`.
Sources were read on 2026-11-21. [P] = primary/official, [S] = secondary. Line refs are against 9df407f.

## 0. Summary

- "Works completely" for a channel = connect from Connections → a scheduled ContentItem publishes through the
  existing scheduler → post URL or a clear error is written back **and shown** → an expired/revoked connection is
  detected and shown as "reconnect" → proven once end to end against the real platform with a test account.
- **The shared publish core is not good enough for that today, for LinkedIn either.** It has to be fixed first (§1).
- One additive migration covers all four channels (§2).
- Costs: Telegram free, WordPress free, Threads free, **X is paid per post** ($0.015 text, $0.20 with a link) (§5).
- Threads needs Meta paperwork; testers (≤ 50) can publish before App Review, so the pilot does not wait for it (§6).
- None of this is ready for 22 Nov. Mentees can use LinkedIn + website on day one; channels follow one PR at a time.

### Recommended order (changes the CPO's order slightly)

| # | Work | Est. dev-days | Why here |
|---|---|---|---|
| 0 | Publish-core fixes (§1) + migration (§2) | 2.5–3.5 | Every channel depends on it; it also fixes LinkedIn retry/disconnect |
| 1 | **Telegram** | 4–5 | Free, no review, matters for Persian-speaking customers |
| 2 | **X** (finish) | 1.5–2.5 | Auth flow already exists; only refresh, counting, media, threads. Needs Farjad's spend approval |
| 3 | **WordPress** (pull plugin) | 5–7 incl. shared renderer | PHP plugin + small Content API additions |
| 4 | **Threads** | 3–4 + 1–1.5 Meta callbacks/page | Code can start any time; GA blocked on Meta review (2–6 weeks, estimate) |
| ∥ | Threads paperwork (Farjad) | — | Start now, in parallel with 0–1 |

Change vs. the brief: X moves before WordPress because, once §1 lands, X is the cheapest channel to finish
(the OAuth flow and adapter exist). If Farjad does not approve X spend, WordPress goes second and X waits.

## 1. Publish core — what is broken today and the fixes (step 0)

Verified in code (file:line) unless marked.

| # | Defect | Where | Effect | Fix |
|---|---|---|---|---|
| C1 | Web mutations send **no Authorization header** | `apps/web/src/app/actions/social.ts:19-43` | Disconnect, Make default, Reconnect, Retry, Cancel all get 401; UI ignores the error (`ConnectedAccountsSection.tsx:82-98`, `PublishQueueSection.tsx:66-77`) | Bearer from `mintApiToken()`; show `{error}` |
| C2 | Errors swallowed in `processJobAsync` | `social-publish.service.ts:357-380` | BullMQ `attempts: 3` never fires; a 429 or network blip is a permanent failure | Adapter returns `retryable`/`retryAfterSec`; service rethrows retryable errors, marks FAILED only on the last attempt |
| C3 | Any validation error = EXPIRED | `validateConnection` → `markConnectionExpired` (`:289-307`, `:392-408`) | A DNS blip disconnects a healthy account | `validateConnection(): ConnectionHealth` = ok / revoked / expired / transient; transient changes no status |
| C4 | `retry()` re-sends `body: ''` and reuses the BullMQ job id | `:157-198`, `:185-187` | Retry publishes nothing or is ignored | Rebuild payload from the ContentItem; jobId `${id}:r${retryCount}` |
| C5 | Token required for every platform | `:248-257` | Telegram (one Contivo bot, token in env) would fail | Adapter declares `credential: 'stored_token' \| 'platform_env'` |
| C6 | No token refresh anywhere | no `grant_type: 'refresh_token'` in `apps/api/src` | X dies after 2 h; Threads after 60 days | `token-refresh.service.ts`: refresh before publish when `< 5 min` left, per-connection lock, persist both tokens in one transaction, re-read row before declaring EXPIRED |
| C7 | Unmapped channels loop forever | `social-scheduler.service.ts:92-96` | `email` items stay SCHEDULED, warn every minute | Park as FAILED with a reason (skip `blog`, which the web publisher owns) |
| C8 | Platform list copied in 7+ places | `social-publish.service.ts:39`, `adapter.factory.ts:21`, `dto/create-social-connection.dto.ts:12`, `packages/types/src/domain/social.ts:14`, `social-oauth.service.ts:33`, `social-oauth.controller.ts:27`, `ConnectModal.tsx:31` | New channel half-added = silent gaps | Import the Prisma enum; one shared channel↔platform table (also `lib/autopilot/channels.ts:38-42`) |
| C9 | Reconnect creates duplicate rows | `social-connections.service.ts:57-91` | Old row lingers | Upsert on (workspaceId, platform, accountIdentifier) in code; unique index later after a dedupe check |
| C10 | `format.includes('x')` routes to X | `apps/web/src/lib/content-engine.ts:78-85` | "checklist", "explainer" go to X | Exact match table |
| C11 | Result not shown where the user works | post URL only in `PublishHistorySection.tsx:135-137`; `failedReason` only in admin | User cannot see why a post failed | Show post URL + failure reason + "reconnect" in the Pipeline (after PR #15 merges — it owns `PipelineTab.tsx`) |

Adapter contract additions (`social-adapter.interface.ts`): `credential`, `ConnectionHealth`,
`PublishResult.retryable/retryAfterSec`, `AdapterConnection.meta` (from `metaJson`),
`PublishPayload.title/slug/format`. The scheduler passes `item.topic` and `item.slug`.

Separate security finding, not in this stream: `apps/web/src/lib/site-api/publisher.ts:139` fetches the
user-supplied `SiteConnection.revalidateUrl` with no SSRF guard. Passed to contivo-security-engineer; that file
belongs to PR #15 / the blog stream.

## 2. Schema — one additive migration (contivo-database-engineer)

```
SocialPlatform  += TELEGRAM, THREADS   (WordPress needs none: it is a SiteConnection, §4)
ContentChannel  += telegram, threads
SocialConnection.metaJson Json?   -- non-secret per-connection settings only
```

- `ALTER TYPE … ADD VALUE` + `ADD COLUMN … NULL`: additive, no backfill, no lock risk worth noting.
  Postgres cannot use a new enum value in the same transaction that adds it; the migration only adds.
- Status enum unchanged: `EXPIRED`, `REVOKED`, `PENDING_REAUTH` already exist (`schema.prisma:892-898`).
- Credentials use existing columns, encrypted with `token-crypto.ts` (AES-256-GCM, `v1:` format, HKDF from
  `SOCIAL_TOKEN_SECRET`):

| Channel | accountIdentifier | authProvider | encryptedAccessTokenRef | encryptedRefreshTokenRef | metaJson |
|---|---|---|---|---|---|
| Telegram | chat id as string (`-100…`) | `telegram_bot` | null (bot token is env) | null | `{chatType, linkedByTelegramUserId}` |
| X | X user id | `oauth2` | access token | refresh token | — |
| Threads | Threads user id | `oauth2` | long-lived token | null | `{lastRefreshedAt}` |

- Announce in the CLAUDE.md stream table (video and funnel streams also touch `schema.prisma`).

### OAuth rule for every new channel (from hotfix PR #20, 22 Nov)
The OAuth callback never saves a connection. It parks the exchanged account in Redis under a one-time ticket and
redirects to `/connections?pending=<ticket>`; the signed-in web page calls `POST /social/oauth/finalize`, which saves
only if the session user is the user who started the flow. X and Threads use this path. Telegram's connect (§3) must
bind the same way: the connect session is created by the signed-in web user and the `chat_shared` result is saved only
for that session's user and workspace. Every id from a request is scoped to the caller's workspace.

## 3. Telegram

**Auth.** One Contivo bot. Token only in `TELEGRAM_BOT_TOKEN` on contivo-api; connection rows hold no secret.
Customers never touch BotFather. Customer-owned bots (white label) fit the same row later; out of scope.

**Connect (works for private channels):**
1. Connections → "Connect Telegram" → server action → `POST /social/telegram/connect-sessions` → 16-byte nonce in
   Redis (10 min) bound to user + workspace → `https://t.me/<bot>?start=<nonce>` (start param ≤ 64 chars `A-Za-z0-9_-` [P]).
2. User taps Start. Webhook gets `/start <nonce>`; bot replies with a `request_chat` keyboard button
   (`chat_is_channel: true`, `bot_administrator_rights.can_post_messages: true`) — Telegram grants the bot the
   rights itself [P]. A second button for groups.
3. `chat_shared` arrives → `getChatMember(chat_id, bot)` must be administrator with `can_post_messages` (channels)
   → upsert the connection → bot confirms in chat → Connections page shows it (polls the session).
Fallback: public channel where the bot was added by hand → paste `@username`, same check.

**Webhook.** `POST /api/v1/social/telegram/webhook`, public, constant-time check of
`X-Telegram-Bot-Api-Secret-Token`. `allowed_updates: ["message","my_chat_member","callback_query"]` (callback_query = the "This wasn't me" button) — never `channel_post`
(we do not read customers' channels). Local dev: `TELEGRAM_UPDATES_MODE=polling` uses `getUpdates` instead
(webhook and getUpdates are mutually exclusive [P]).

**Publish.** `parse_mode: HTML` (MarkdownV2 escaping breaks on model-written punctuation). Our markdown subset →
`b i u s a code pre blockquote`; headings → bold, lists → "• ". Limits [P]: text 4,096, caption 1,024, photo
10 MB. Split on block boundaries, ≤ 3,800 chars per message, ≥ 1 s between messages. Image: post ≤ 1,024 chars
→ one `sendPhoto` with caption; else photo then text. Each sent `message_id` is logged so a retry never re-posts
parts already sent. Persian: keep links/hashtags at the end so the bubble stays RTL (ASSUMED, check on device).

**Write-back.** `externalPostId = <chat_id>:<message_id>`; URL `https://t.me/<username>/<id>` (public) or
`https://t.me/c/<chat_id without -100>/<id>` (private, members only; `-100` rule ASSUMED, verify).

**Errors → status.** 403 / "chat not found" / "need administrator rights" → REVOKED. 429 → retry after
`parameters.retry_after`. `migrate_to_chat_id` → update identifier, retry once. 5xx/network → transient.
Proactive: `my_chat_member` with status `left|kicked`, or rights lost → REVOKED immediately.

**Cost/policy.** Free. No review. Sources: https://core.telegram.org/bots/api ,
https://core.telegram.org/bots/features , https://core.telegram.org/bots/faq

**Farjad does.** Create the bot in @BotFather (username is a brand choice, e.g. `ContivoAppBot`); set
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` on contivo-api; run the `setWebhook`
command we hand over; create a test channel for the end-to-end proof.

## 4. WordPress — Contivo plugin that pulls (decided by Farjad 2026-11-21)

Replaces the earlier REST + Application Password design. Farjad chose a plugin; the pull variant was
recommended and approved.

**Why pull.** Contivo stores no WordPress password; Contivo never makes requests into the customer's site for
publishing (no SSRF surface, no Cloudflare/Wordfence blocks of Railway, no hosts stripping `Authorization`);
it reuses what exists: Content API `GET /api/v1/posts` (`apps/web/src/app/api/v1/posts/route.ts`), per-site API
keys (`lib/site-api/keys.ts`, `auth.ts`), `SiteConnection` (`lastFetchedAt`, `revalidateUrl`), the `blog` channel and
its web publisher. **No new enum value** (WordPress is a `SiteConnection`, not a `SocialConnection`).

**Flow.**
1. Connections → Websites → "WordPress": create a site connection (key shown once) + download the plugin zip.
2. Customer installs the plugin, pastes the key. Plugin calls a new `GET /api/v1/site` (key check) and shows
   "Connected to <workspace>".
3. Contivo publishes a `blog` item (existing web publisher, SCHEDULED → PUBLISHED) and pings `revalidateUrl`
   = the plugin's REST route `/wp-json/contivo/v1/sync` with the site secret (Bearer). The plugin also syncs on
   WP-Cron every 5 minutes as a fallback (ping can be blocked; low-traffic sites run WP-Cron late).
4. Sync: `GET /api/v1/posts?updatedSince=<cursor>` → for each post, find the WP post by meta `_contivo_id`,
   create or update it (title, `html`, slug, excerpt, status, featured image sideloaded from a Contivo image URL),
   store the cursor.
5. Write-back: plugin `POST /api/v1/posts/{id}/ack {wpPostId, permalink, status}` → stored on the ContentItem
   (needs a field: `externalPostUrl` on ContentItem or a small `SitePublishReceipt` table — database-engineer
   decides in the WordPress PR) → shown in the Pipeline like social posts.

**Contivo-side changes (WordPress PR).** `updatedSince` filter and an `html` field on the posts API (one renderer
on our side: move `lib/blog/content.ts` parser into a shared package, `renderHtml()`); `GET /api/v1/site`; ack
endpoint; public image URL for artwork; Connections "WordPress" card with plugin download, last sync time and
"not syncing" warning when `lastFetchedAt` is older than 1 h while posts are due; **SSRF guard on the
`revalidateUrl` ping** (`site-api/publisher.ts:139`, https only, block private ranges, no redirects).

**Plugin (`integrations/wordpress-plugin/contivo/`, PHP ≥ 7.4, WP ≥ 6.0).** Settings page (key, default
status publish/draft, default category, author), REST sync route (constant-time secret check), cron, idempotent
upsert by `_contivo_id`, media sideload with size cap, admin notice on 401 ("key revoked — reconnect in Contivo"),
uninstall cleans options only (never deletes posts). Escapes everything; content `html` passed through
`wp_kses_post`. Distribution: zip download from contivo.app for the pilot; WordPress.org listing later (review
takes weeks, optional).

**Expiry/revocation.** Key revoked or site deleted in Contivo → plugin gets 401 → admin notice. Plugin removed or
blocked → `lastFetchedAt` stale → Connections shows "site not syncing" and due posts show "waiting for your site".

**Limits.** Requires a host that allows plugins (WordPress.com Free/Personal/Premium do not). Timing is "within
minutes", not to the second, when the ping is blocked.

**Effort (estimate).** Plugin 3–4 dev-days; Contivo side 1–2; shared renderer 1–2.

**Farjad does.** Provide one test WordPress site where a plugin can be installed; default post status
(recommend publish, switch in plugin settings).

## 5. X

**Access and cost [P] https://docs.x.com/x-api/getting-started/pricing (read 21 Nov 2026).** No Free/Basic/Pro
for new developers; pay-per-use credits only. Post create $0.015; **post containing a URL $0.20**; user lookup
$0.01 per user per UTC day; failed requests not billed. Limits: 10,000 posts / 24 h per app, 100 / 15 min per user
[P] rate-limits. Posting for other users via OAuth 2.0 user context is allowed on self-serve [P].

| Pilot scenario | Posts / month | Text only | All with link |
|---|---|---|---|
| 10 accounts × 2/day | 600 | $9 | $120 |
| 30 accounts × 3/day | 2,700 | $40.50 | $540 |

Recommendation: $25 first purchase, auto-recharge, **spending limit $75/month**, **no URL in X posts by default**
(per-post opt-in showing the cost). Incentive credits ($20 + up to $50 match, expire in 3 months [P]) cover about the
first month.

**Auth.** OAuth 2.0 + PKCE (exists, `social-oauth.service.ts:196-273`). Scopes `tweet.read tweet.write users.read
offline.access media.write`. Access token 2 h; refresh token returned with `offline.access` [P]; rotation on
refresh [S] — handled by the C6 lock. Revoke → 401; refresh failure → 400 (`invalid_request` [S]) → EXPIRED.
Move hosts to `x.com` / `api.x.com` (old hosts still answer today, verified). Fix `xCallback` not checking
`/users/me` success (`:252-255`).

**Publish.** Weighted count with `twitter-text` (URL 23, emoji 2, Persian weight 1 [P] twitter-text v3 config)
validated on the **final** text (today `platform-validator.ts:43-60` checks raw length before hashtags/link
are appended). Long posts → thread: each part `reply.in_reply_to_tweet_id` the previous (self-replies reportedly
still allowed under the Feb 2026 reply restriction [S] — prove with one real thread before claiming threads).
Image: `POST /2/media/upload` (≤ 5 MB) then `media.media_ids` [P]; today the image is silently dropped.
Write-back `https://x.com/<username>/status/<id>`. Map 402/403 "credits exhausted" to its own message.

**Policy [P] https://docs.x.com/developer-guidelines.** Scheduled, AI-written posts need no approval from X.
Forbidden: identical content across accounts, unsolicited @mentions. So: the customer approves/schedules each
post; never post the same text to two workspaces' X accounts (add a cross-workspace duplicate check).

**Farjad does.** Create the app at console.x.com (OAuth 2.0, Web App, Read and write), callback
`https://contivo-api-production.up.railway.app/api/v1/social/oauth/x/callback` (route exists, verified 400 on GET);
set `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_REDIRECT_URI` on contivo-api; add a card and buy credits
**after approving the spend**; decide on the "Automated" account label (recommend no, because every post is approved
by the account owner).

## 6. Threads (Meta)

**API [P] https://developers.facebook.com/docs/threads/posts , /overview , /get-started/long-lived-tokens.**
Container `POST /{user-id}/threads` → wait → `POST /{user-id}/threads_publish`. Text 500 chars; images JPEG/PNG
≤ 8 MB **fetched by Meta from a public URL** (we store artwork bytes in the DB → need a short-lived signed public
image URL on contivo-api); ≤ 5 links; 250 posts / 24 h per profile. Reply chains need `threads_manage_replies`.
Tokens: 1 h short-lived → long-lived 60 days → refresh via `th_refresh_token` (a refresh cron every ~50 days;
expired tokens cannot be refreshed). Permission grants last 90 days; private profiles must re-grant [P].
Permissions: `threads_basic`, `threads_content_publish` (+ `threads_manage_replies` only if threads ship).

**Pilot without review [P] app-roles.** Up to 50 Threads Testers on an unverified app (500 after Business
Verification); testers can publish before App Review. Each mentee accepts the invite in Threads → Settings →
Account → Website permissions before connecting.

**General availability.** Business Verification of Ashavid Inc. + App Review (advanced access) with screencast.
At least one successful call per permission in the last 30 days before the request button unlocks.
No official SLA; plan 2–6 weeks including one rejection (estimate) [S].

**Contivo must host (status verified by curl 21 Nov):**
| URL | Today | Needed |
|---|---|---|
| `/en/privacy`, `/fa/privacy` | 200, names only LinkedIn and X | Add Threads/Telegram/WordPress; Persian written natively |
| `/en/terms` | 200, names LinkedIn and X | Same |
| `/en/data-deletion` (+ fa) | 404 | New public page (new-public-page checklist) |
| API data-deletion callback | missing | `signed_request` HMAC check, delete connection, return `{url, confirmation_code}` |
| API deauthorize callback | missing | `signed_request`, mark REVOKED, delete token |
| `/api/v1/social/oauth/threads/callback` | missing | Must match the dashboard exactly |

The submission pack (use-case text per permission, 10-step screencast shot list, reviewer instructions) is drafted
in the CTO work folder and will be finalised when the Threads build is running, because the screencast must show
the real feature. One gap: App Review for `threads_basic` expects us to show the user's own posts in Contivo —
either build a small "recent Threads posts" list or request only what we show.

**Farjad does (start now).** Meta developer app with the "Access the Threads API" use case; start Business
Verification for Ashavid Inc. in Meta Business Manager (slowest item); later the Threads app id/secret on
contivo-api and tester invites.

## 7. Expiry / revocation, per channel

| Channel | Detected by | Shown as |
|---|---|---|
| Telegram | `my_chat_member` webhook (immediate) + publish errors | REVOKED → "Reconnect" |
| WordPress | plugin gets 401 (admin notice) + `lastFetchedAt` stale in Contivo | "Site not syncing" → reinstall/re-key |
| X | refresh failure (400/401) before publish | EXPIRED → "Reconnect" |
| Threads | refresh cron failure, publish 190 token errors, deauthorize callback | EXPIRED/REVOKED → "Reconnect" |

"Reconnect" must actually start the connect flow (today it only sets PENDING_REAUTH,
`social-connections.service.ts:133-141`).

## 8. Verification per channel (definition of done)

1. Unit tests for adapter payload building, splitting/counting, error → health mapping (mocked HTTP), plus
   service tests for retry/transient handling.
2. Local end to end against the **real** platform with a test account: connect from the UI, schedule a post 2 min
   ahead, scheduler → job → post exists on the platform, URL written back and shown; then revoke on the platform
   side and show "Reconnect".
3. contivo-qa-engineer drives the flow and gives go/no-go; contivo-security-engineer reviews credential handling.
4. Public site copy and the "soon" inventory change only after the channel is proven live in production.

## 9. Out of scope

LinkedIn company Pages, Instagram/Facebook/TikTok, WordPress.com OAuth, customer-owned Telegram bots, X quote posts,
analytics pull-back, editing/deleting published posts.

## 10. Decisions for Farjad

1. Order: §0 table (X before WordPress) — or keep Telegram → WordPress → X → Threads.
2. X spend: pay-per-use, $75/month cap, no links in X posts by default.
3. WordPress default status: publish (recommended) or draft.
4. Telegram bot username.
5. Start Meta Business Verification now.
