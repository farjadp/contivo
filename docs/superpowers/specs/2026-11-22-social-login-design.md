# Social sign-in: Google, GitHub, Facebook — design

Date: 2026-11-22 · Owner: contivo-cto · Branch: `myca/social-login-397702` · Status: **approved by Farjad 22 Nov: build Google first, then GitHub; Facebook dropped from v1**
Provider setup list for Farjad: `2026-11-22-social-login-provider-setup.md` (same folder).

## 1. Goal

A customer can create an account and sign in with Google, GitHub or Facebook, next to email + password.
Every path ends by minting the existing `auth-token` cookie (`createSessionCookie`), so guards, `mintApiToken()`
and the Nest API stay unchanged. The whole feature lives in `apps/web`, plus one additive migration.

## 2. What the code does today (verified in this worktree)

- One HS256 cookie, 7 days, `apps/web/src/lib/auth.ts`. `SessionPayload = { userId, email, role }`.
- `login` / `register` in `apps/web/src/app/actions/auth.ts`: DB rate limits (`consumeRateLimit`), `isUserSuspended`,
  `ensureWelcomeCredits` (a credit grant that buys real model calls: sign-up farming matters), `writeActivityLog`
  (`USER_SIGNED_IN` / `USER_SIGNED_UP`), then redirect to `/dashboard` or `/admin`.
- `User`: `email @unique` (case-sensitive), `passwordHash String?` (already nullable), `name`, `avatarUrl`, `cohort`, `lastSeenAt`.
  No email verification, no email sending, **no change-password or set-password feature** anywhere.
- `?cohort=` is read on `/sign-up`, passed as a hidden field, and accepted only if in `SIGNUP_COHORTS` (`allowedCohort`).
  `?site=` is normalised by `normalizeIntakeSite`, shown on the page and written to the first-party cookie
  `contivo_intake_site` (24 h, readable by JS) which `/growth/new` reads.
- `SESSION_STARTED` and `lastSeenAt` are written by `touchLastSeen` from the dashboard layout on any signed-in request,
  so an OAuth sign-in gets them for free as soon as the cookie exists. Only the `USER_SIGNED_UP/IN` log lines need provider info.
- `proxy.ts` is locale routing only; auth is in layouts. `apps/web/src/app/api/**` holds route handlers.
- `token-crypto.ts` (AES-256-GCM, HKDF) lives in `apps/api`, for social *publishing* tokens. Not needed here (see §7).
- `jose` is already a web dependency. No OAuth library is installed.

## 3. Options

| | A. Hand-rolled with `jose` only | B. **Arctic + `jose`** | C. Auth.js (next-auth v5) |
|---|---|---|---|
| What it is | We write auth-URL building, PKCE, code exchange, JWKS verification ourselves, ×3 providers | Arctic v3 (small, MIT, no framework) builds URLs, does PKCE and the code exchange; we do state, linking, id-token claims check with `jose` | Full framework: routes, adapters, sessions |
| Size | ~350 lines + tests | ~200 lines + tests | Config is small, but see below |
| Session fit | Native | Native | **Conflict**: owns the session cookie and its JWT format. Forcing it to mint our `auth-token` needs custom `jwt.encode/decode` and bypasses its DB adapter. Our guards, `mintApiToken` and the Nest guard all read our payload. v5 has been in beta for years |
| Linking rules | Ours | Ours | Its built-in `allowDangerousEmailAccountLinking` is exactly the takeover we must avoid; we would override its callbacks anyway |
| Risk | Most surface for subtle protocol bugs (token endpoint quirks: GitHub form vs JSON, Facebook Graph versions) | Provider quirks are handled by a maintained library; protocol checks stay explicit in our code | Large dependency, upgrade churn, we fight the abstraction |

**Pick: B, Arctic + `jose`.** It removes the provider-quirk bugs without taking over the session or the collision policy,
which are the two parts that are Contivo-specific and security-critical. Option C is rejected because it does not remove
code we would write (state, linking, tracking) and puts a second session system next to ours.
Arctic is a new dependency: pin an exact version, check its changelog and `npm audit` in the PR, contivo-security-engineer signs off.
Fallback if Arctic is a problem: option A, same module boundaries.

## 4. Flow

Routes (route handlers, no locale prefix, so each provider has exactly one redirect URI):

- `GET /api/auth/oauth/[provider]/start?intent=signin|signup&locale=…&cohort=…&site=…`
- `GET /api/auth/oauth/[provider]/callback`

`[provider]` ∈ `google | github | facebook`; anything else is 404. A provider with no credentials in env is 404 on both routes
and its button is not rendered.

**start**
1. Rate limit per IP (`oauth:start:ip`, 30/15 min).
2. Validate inputs: locale against `routing.locales`; cohort with the same allowlist function as today (extracted from
   `actions/auth.ts` into `lib/signup-cohort.ts`, behaviour unchanged); site with `normalizeIntakeSite`. Invalid values are dropped, never an error.
3. Generate `state` (32 random bytes), PKCE `code_verifier`, and for Google a `nonce`.
4. Seal `{ provider, state, verifier, nonce, locale, cohort, site, intent, jti, exp: now+10min }` into an HttpOnly,
   `SameSite=Lax`, `Secure`, `Path=/api/auth/oauth` cookie `oauth_tx`, signed (HS256 via `jose`) with a key derived by HKDF
   from `JWT_SECRET` with its own `info` string (so it cannot be confused with a session token; **no new secret**).
5. 302 to the provider with `state`, `code_challenge` (S256), `nonce`, minimal scopes (§6).

**callback**
1. Read and verify `oauth_tx` (signature, `exp`, provider matches the path). Always delete the cookie, success or not.
2. `state` query param must equal the cookie's `state` (constant-time). Missing/mismatch → `invalid_state` error.
3. **Single use:** `consumeRateLimit('oauth:tx:'+jti, 1, 15min)` must be allowed. A second use of the same transaction
   is refused. (Reuses the existing DB limiter; no new table.) The provider's authorization code is also single-use at the provider.
4. Provider `error=access_denied` → `cancelled`. Any other provider error → `provider_error`. Provider error text is never shown or reflected.
5. Exchange code with `code_verifier`. Google: verify the `id_token` with `jose` + Google JWKS (`iss`, `aud` = our client id, `exp`, `nonce`),
   require `email_verified === true`. GitHub: `GET /user` (numeric `id` = account id) and `GET /user/emails` (primary AND verified entry; the
   `email` field of `/user` is never used). Facebook: `GET /me?fields=id,name,email`.
6. Discard the access token immediately; nothing is stored or logged (§7).
7. Resolve the account with the rules in §5, create the session cookie, redirect.

**After success:** `createSessionCookie` (role read from the DB row, never from the provider), `ensureWelcomeCredits`,
set `contivo_intake_site` (same name, same attributes as `rememberIntakeSite`) if `site` is valid, redirect to
`/{locale}/dashboard` or `/{locale}/admin` exactly like password sign-in. The cohort is written once, on creation only (§5).
Sign-up from OAuth shares the **same per-IP register bucket** (5/h) as the password path; sign-in shares the per-IP login bucket.
Suspended users are refused with the same message as password sign-in.

## 5. Account resolution and the collision rule

Why not "match by email and log in": passwords are **not email-verified**. Someone can register `victim@example.com`
with a password they know today, and when the victim later signs in with Google, an email-match merge would hand the victim's
session to an account the attacker also holds a password for. So an email match is never enough on its own.

Inputs: `(provider, providerAccountId, email, emailVerified, name)` from §4 step 5. Email is lower-cased and trimmed.
Lookup by email is **case-insensitive** and, if it matches more than one row (the column is case-sensitive unique), is treated as a collision.

1. **Known identity** (`oauth_accounts` has `(provider, providerAccountId)`) → sign that user in. Email changes at the provider are ignored. This is the only path that does not need an email.
2. **Unknown identity, no verified email** → refuse (`no_verified_email`), create nothing. Plain message: we need an email the provider has confirmed; for GitHub, add and verify one; for Facebook, allow email access or use another method.
3. **Unknown identity, verified email, no user with that email** → create the user (`passwordHash = null`, `role USER`, `plan FREE`, `name` from provider, **no avatar stored**, cohort from `oauth_tx` if still allow-listed), link the identity, log `USER_SIGNED_UP`.
4. **Unknown identity, verified email, a user with that email exists** → **always refuse, never sign in, never merge** (`email_in_use`), whether that user has a password or not. Message: "An account with this email already exists. If it is yours, sign in the way you did before, then connect Google in Settings. If you did not create it, contact us." Logged as `OAUTH_LOGIN_REFUSED` (provider + reason, no email). (Security review H1: a once-verified identity email is not proof of ownership today, because mailboxes and domains get recycled, so the old "auto-link when both are verified" rule is deleted.)
5. **Linking happens only in Settings, while signed in, with re-authentication** (security review H2/M2): *Settings → Sign-in methods → Connect Google* requires the account's password (password accounts) or a fresh login with an already-linked provider (OAuth-only accounts) within the last 10 minutes. The link flow is started by a POST, the `intent=link` and the session `userId` are sealed inside the `oauth_tx` cookie, and the callback binds the identity to that user only, refusing if the identity already belongs to another user. There is **no pending-link cookie** and no linking at password sign-in (that variant let a squatter's password pull a victim's provider identity into the squatter's account).

**Known residual risk (cannot be closed without email verification):** an attacker who pre-registers `victim@…` with a password makes rule 4a block the real owner from using Google. It does not give the attacker the owner's data, but it squats the address. Mitigation now: support path (admin can detach the squatter after identity check). Real fix: email verification when Resend is built. This is why rule 4a blocks instead of merging.

**Facebook special case.** Meta documents the email as present only when the user has a valid email and does not expose an "email verified" claim. So for Facebook:
the email is usable to *create* an account when free (rule 3), stored as `emailVerified = false`, and never counts as proof for another provider. If the same address later arrives from Google/GitHub (verified), it hits rule 4 and is refused. Decision for Farjad in §12: keep Facebook with this restriction, or drop it.

**Unlink and lockout.**
- `unlinkProvider` server action (Settings): allowed only if the user would still have a way in: a password exists, or another identity remains. Otherwise refused with a plain message. Logged `OAUTH_UNLINKED`.
- An OAuth-only user has **no password and the product has no set-password feature**. v1 does not add one: such a user keeps their provider as the way in, and cannot unlink the last one. (If the provider account is lost, support handles it; `set password via email` needs the email sending that does not exist.) Noted as debt in §11.
- Password sign-in form for an OAuth-only account keeps returning the generic "invalid credentials" (no account enumeration; no "use Google" hint).

## 6. Provider details

| | Google | GitHub | Facebook |
|---|---|---|---|
| Protocol | OIDC, auth-code + PKCE + nonce | OAuth 2.0 auth-code + PKCE (supported on OAuth Apps) | OAuth 2.0 auth-code + PKCE via Facebook Login (web) |
| Scopes | `openid email profile` | `read:user user:email` | `public_profile email` (default access, no App Review) |
| Stable id | `sub` | numeric `id` (never the login name) | `id` (app-scoped) |
| Email | `email` + `email_verified` from verified id_token | primary & `verified` from `/user/emails` | `email` from `/me`, may be absent; treated unverified |
| Env | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` |
| Callback | `https://www.contivo.app/api/auth/oauth/google/callback` | `…/github/callback` | `…/facebook/callback` |

Each provider is active only when **both** its env vars are set (`lib/oauth/providers.ts` → `enabledProviders()`); server components render the buttons from that list. No credentials = no button and 404 routes. The callback origin is `NEXT_PUBLIC_APP_URL`/request origin allow-listed to `www.contivo.app` and localhost (to be confirmed against how other absolute URLs are built in the app during build).
If GitHub rejects PKCE parameters on OAuth Apps, we keep state + secret exchange for GitHub only (documented in code); this is checked against the real test app.

## 7. Tokens and privacy

- We need identity only at sign-in. Access/refresh tokens are **not stored and not logged**; they live in memory for the length of the callback. So there is nothing to encrypt, and `token-crypto` is not reused. (If a later feature ever needs a provider token, it goes through the AES-GCM approach in `apps/api/.../token-crypto.ts` and a new spec.)
- Stored per identity: provider, provider account id, the email as the provider reported it, whether the provider verified it, created/last-used timestamps. From the provider profile we copy only the display name, once, at creation. No avatar URL (hotlinks expire and leak the viewer's IP to the provider).
- Logging: never the code, the tokens, the id_token, or the email in error logs. Log provider, outcome code, user id.
- Provider-side data: Google, GitHub and Meta each learn that the person signed in to Contivo; they act as **identity providers/processors for sign-in only**.

## 8. Schema (one additive migration)

Migration `20261123090000_oauth_accounts`. Nothing existing is altered or dropped.

```prisma
enum OAuthProvider { GOOGLE GITHUB FACEBOOK }

model OAuthAccount {
  id                String        @id @default(cuid())
  userId            String
  provider          OAuthProvider
  providerAccountId String
  email             String?       // as reported by the provider, lower-cased
  emailVerified     Boolean       @default(false)
  createdAt         DateTime      @default(now())
  lastUsedAt        DateTime?
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@unique([userId, provider])        // one identity per provider per user
  @@index([userId])
  @@map("oauth_accounts")
}
// User gets: oauthAccounts OAuthAccount[]
```

`apps/api/prisma/schema.prisma` is shared, so the BOARD row claims it for this addition only. Production order is schema first
(`prisma migrate deploy` from this branch), then web. The Nest API does not read the table.

## 9. Tracking

All in `activity_log` (existing `writeActivityLog`), same shape as the password path:

- `USER_SIGNED_UP` `{ locale, cohort, provider, method: 'oauth' }`; password path gets `method: 'password'` (additive field).
- `USER_SIGNED_IN` `{ locale, provider, method: 'oauth' }`.
- `OAUTH_LINKED`, `OAUTH_UNLINKED`, `OAUTH_LOGIN_REFUSED { provider, reason }` (no email).
- `SESSION_STARTED` and `lastSeenAt`: unchanged, produced by `touchLastSeen` once the cookie is set. Cohort tag: written to `users.cohort` at creation.
- Note for contivo-head-of-data: funnel reports that group by sign-up method can now split by `provider`; refusal reasons show friction.

## 10. UI and copy

- Sign-in and sign-up pages: a "Continue with Google / GitHub / Facebook" stack above a divider ("or use email"), only for enabled providers. Both pages create an account if none exists (we cannot tell sign-in from sign-up at a provider), so both show a fine-print line linking Terms and Privacy. Sign-up passes `cohort` and `site` to `start`; sign-in passes neither.
- Buttons follow brand rules: official Google "G" on white/neutral with the exact label pattern "Continue with Google"; GitHub mark with "Continue with GitHub"; Facebook "f" logo in Meta blue with "Continue with Facebook". Logos are inline SVG from each provider's brand kit (no hotlinking); do not recolour; icon size/padding per each guideline. Labels are translated (provider names stay Latin); RTL mirrors the order of icon and text.
- Errors: `/{locale}/sign-in?error=<code>`; codes `cancelled`, `invalid_state`, `provider_error`, `no_verified_email`, `email_in_use_password`, `email_in_use_contact`, `suspended`, `rate_limited`. Rendered from `auth.json` keys, never from provider text. Persian written natively (persian-writing); each of en/fa/it/es/he written natively, not translated word by word.
- Settings gets a "Sign-in methods" card: connected providers, connect, unlink (with the lockout rule).
- Namespaces touched: `messages/{en,fa,it,es,he}/auth.json` and `settings.json` (app locales). The marketing/legal pages also exist in fr/ar/zh.

**Legal (coordinated through contivo-coo → legal-compliance-specialist):** Privacy page names Google, GitHub (Microsoft) and Meta as sign-in identity providers; says exactly what we receive (name, email, provider account id), what we do not (no contacts, posts, friends, no stored tokens); that sign-in is optional; how to delete the account and data (also the instructions URL Meta requires). Terms: one sentence that signing in with a provider is subject to the provider's own terms and that a sign-in creates a Contivo account under these Terms. Pages: `legal.json` for en, fa, it, es, he, fr, ar, zh (8). English canonical text from legal; native versions per locale in the same PR.

## 11. Security gate, tests, debt

Security review (contivo-security-engineer) before merge, specifically: state/PKCE/nonce handling, cookie flags and `Path`, open redirect (`locale` and `site` are never used as redirect targets; the redirect is built from our own allow-listed locale), id_token claim checks, constant-time compares, the 4a/4b/4c rules, enumeration, logging hygiene, the Arctic dependency.

Tests (Vitest, providers mocked at the HTTP boundary): state tampering (flipped bit, wrong provider, missing cookie, expired); replay of the same callback (second use refused); PKCE verifier mismatch; Google nonce mismatch, `email_verified=false`, wrong `aud`; GitHub: no primary-verified email, email only in `/user` ignored; Facebook: no email; collision matrix 3 / 4a / 4b / 4c / known identity / duplicate-case emails; pending-link completes only with the right password and only once; unlink lockout; suspended; cohort allowed and not allowed round trip; `site` round trip and garbage dropped; locale preserved incl. fa; the role is never taken from provider data; registration bucket shared; a provider without env is 404 with no button. Then QA drives each provider on production with Farjad's real logins.

Debt register: (1) no email verification → residual squat case (§5), real fix is Resend; (2) no set-password for OAuth-only users; (3) Facebook email unverified, so Facebook users cannot be auto-linked; (4) no account-deletion self-service yet (Meta needs instructions only).

## 12. Decisions needed from Farjad

1. **Go for option B (Arctic + jose)** and the order Google → GitHub → Facebook.
2. **Collision rule §5**: existing password account is never merged by email; the owner links from Settings or by signing in with the password. OK?
3. **Facebook**: keep with the "create only, never auto-link" restriction, or drop Facebook for now (Meta also needs a Live-mode app, privacy URL, deletion URL; the other two are easier)?
4. **Meta data deletion**: use an "instructions URL" (a section on the Privacy page, no code) now; build a signed-request callback later only if needed. OK?
5. Sign-in page buttons also create accounts (with fine print). OK?

## 13. Legal review findings (contivo-coo, 22 Nov) — folded in

Wording: `2026-11-22-social-login-legal-wording.md` (English canonical, not legal advice).
- The Privacy cookies section says "three cookies"; `__Host-oauth_tx` (10 min) makes that false, so that section and the meta description are edited in the same PR.
- No self-service account deletion exists. The `delete-account` section says to write to the contact address (`lib/site-identity.ts`), and the 30-day promise relies on a manual user-row delete (which cascades to `oauth_accounts`). Decision for Farjad: ship with manual deletion, or add self-service first (product ask, separate).
- Facebook-only users have no verified email, so deletion requests are hard to verify; the copy asks for the provider name and allows one confirmation question.
- Meta may reject a `#fragment` instructions URL; fallback is a `/delete-account` route rendering the same section.
- A lawyer should look at lawful basis, accepting Terms by click with no checkbox, age gate and the Facebook-only deletion case before the provider apps go to review. The English Privacy page must be live before any app is submitted.

## 14. Security review changes (contivo-security-engineer, 22 Nov) — these override earlier text

Full review: `side-session-notes/.../social-login-security-review.md`. Decisions in the spec:

- **H1 / H2:** rule 4b and the pending-link cookie are deleted (see §5). Every email match is a refusal; linking only in Settings with re-auth.
- **H3 single use:** not `consumeRateLimit` (it fails open on DB errors and leaves a permanent row per login). Instead a dedicated table in the same migration: `oauth_tx_used (jti text primary key, expiresAt timestamp)`, `INSERT … ON CONFLICT DO NOTHING`, a conflict or any DB error refuses the callback (fail closed); expired rows pruned opportunistically.
- **M1:** the transaction cookie is named `__Host-oauth_tx` (Secure, Path=/, no Domain, so a sibling subdomain cannot plant one). In local dev over http the plain name is used.
- **M2:** link/unlink need re-auth (see §5 rule 5). Unlink also re-auths.
- **M3 Facebook:** **recommendation: drop Facebook from v1** (unverified email lets anyone squat an address). Build Google and GitHub first; Facebook only if Farjad wants it, then with the create-only restriction plus a placeholder-free requirement of an email we cannot verify, i.e. still refused for existing emails. Pending decision 3.
- **M4 email case:** OAuth lookups are case-insensitive and refuse on more than one match. A separate follow-up (own PR, needs a read-only duplicate query on production first, which Farjad must approve) normalises `register`/`login` to lower-case and adds a `lower(email)` unique index. Not part of this PR.
- **M5:** `redirect_uri` and every redirect are built from a constant (`NEXT_PUBLIC_APP_URL`, validated at start-up), never from the request origin.
- **M6:** before build, verify what Railway sends in `X-Forwarded-For`; the OAuth register bucket is charged only when an account is actually created.
- **L1** `oauth_tx` is an encrypted JWT (`EncryptJWT`) with `typ`/`aud`. **L2** callback sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; code/state never logged; Arctic errors wrapped. **L3** Google: accept both `iss` forms, check `azp`, strict boolean `email_verified`, `prompt=select_account`, no offline access, fail closed if JWKS fails. **L4** GitHub `*@users.noreply.github.com` addresses are refused as an email (they prove nothing). **L5** user + identity created in one transaction, `P2002` race handled. **L6** `intent` reduced to link only. **L7** pin Arctic exactly and review `@oslojs/*`.
- Schema addition: `oauth_tx_used` (§8).

## 15. Farjad's go (22 Nov)

"Go ahead, no Facebook, start Google." So: v1 = Google, then GitHub; Facebook is out (its code, env vars and Meta app are not built; §5 Facebook paragraph and the Facebook column are future work only).
Open points defaulted by the CTO, to be overridden if Farjad says otherwise: sign-in page buttons also create accounts (fine print shown); account deletion stays manual for now; lawyer review before the provider apps go to review is Farjad's call and does not block the build; the e-mail case normalisation + duplicate query is a separate follow-up PR, not part of this one.
