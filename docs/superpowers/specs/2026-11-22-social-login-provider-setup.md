# Social sign-in: what Farjad creates at each provider

You do these steps; agents never create apps, accounts or env vars. Order: Google → GitHub → Facebook.
Do not paste secrets in chat, in the repo or in Notion. Put them straight into Railway (service `contivo-web`) and into your own
`apps/web/.env.local` for local tests. Console screens change; where I am not sure, it says "check".

Redirect URIs (exact, no trailing slash, `https` for production):

| Provider | Production | Local |
|---|---|---|
| Google | `https://www.contivo.app/api/auth/oauth/google/callback` | `http://localhost:3000/api/auth/oauth/google/callback` |
| GitHub | `https://www.contivo.app/api/auth/oauth/github/callback` | `http://localhost:3000/api/auth/oauth/github/callback` |
| Facebook | `https://www.contivo.app/api/auth/oauth/facebook/callback` | `http://localhost:3000/api/auth/oauth/facebook/callback` |

Env vars on `contivo-web` (names only):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`.
No other new variable (the state cookie key is derived from the existing `JWT_SECRET`). A provider with its two variables unset shows no button.

Pages every provider asks for, once the legal work in this PR is live:
home `https://www.contivo.app`, privacy `https://www.contivo.app/en/privacy`, terms `https://www.contivo.app/en/terms`.
Use a support email you actually read as the contact address.

## 1. Google

1. console.cloud.google.com → new project `Contivo`.
2. APIs & Services → **OAuth consent screen** (may be called "Google Auth Platform → Branding"): User type **External**, app name `Contivo`,
   support email, developer email, home/privacy/terms URLs above, authorized domain `contivo.app`.
   *Do not upload a logo at first*: a logo triggers Google's brand verification, which can take days. Add it later.
3. Data access / scopes: only `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (non-sensitive, no review needed; check).
4. **Publishing status → "In production"**. Testing mode caps you at 100 test users and expires grants after 7 days; do not leave it there.
   Confirm the status reads "In production" before the mentee cohort uses it.
5. Credentials → Create credentials → **OAuth client ID** → Web application → name `contivo-web`.
   Authorized JavaScript origins: leave empty (we use the redirect flow). Authorized redirect URIs: the two Google URIs above.
6. Copy client ID and secret to Railway and `.env.local`.

What Google shows people: "Sign in to Contivo" / "Contivo wants to access your Google Account: your name, email address and profile picture."
Until you add a logo and verify the brand, the screen shows no logo and the name `Contivo`. It does not show "unverified app" for these basic scopes (check on first run).

## 2. GitHub

1. github.com → Settings → Developer settings → **OAuth Apps** → New OAuth App (an *OAuth App*, not a GitHub App).
   Preferably under an organisation you own rather than a personal account (the app's owner name is shown to users).
2. Application name `Contivo`, homepage `https://www.contivo.app`, description short, **Authorization callback URL = the production URI**.
3. GitHub allows **one callback URL per OAuth App**, so make a second app, `Contivo (local)`, with the localhost URI for testing.
4. Generate a client secret; copy ID and secret to Railway (production app) and `.env.local` (local app).
5. Scopes are requested by our code: `read:user user:email`.

What GitHub shows: "Contivo by <owner> would like permission to: Read access to your profile information and Access your email addresses (read-only)."
People with no verified GitHub email cannot sign up with GitHub; they get a message to verify one or use another method.

## 3. Facebook / Meta

1. developers.facebook.com → My Apps → Create app → use case **Authenticate and request data from users with Facebook Login**
   (if shown "Other"/"Consumer", pick Facebook Login for web). App name `Contivo`, contact email.
2. Facebook Login → Settings: Client OAuth Login **on**, Web OAuth Login **on**, "Enforce HTTPS" on, Valid OAuth Redirect URIs = the production URI
   (and the localhost URI while developing; localhost works in Development mode).
3. App settings → Basic: App domains `contivo.app`, **Privacy Policy URL**, Terms URL, an app icon (1024×1024), category, contact email.
4. **Data deletion**: App settings → Basic → "User data deletion" → choose **Data deletion instructions URL** and use
   `https://www.contivo.app/en/privacy#delete-account` (a section this PR adds). A callback URL is the alternative; not needed for v1.
5. Permissions: `public_profile` and `email` are available at standard access without App Review (check in App Review → Permissions and features).
6. **Switch the app to Live mode** (top toggle). In Development mode only people with a role on the app can log in. Live mode requires steps 3 and 4 to be complete.
   Meta may also ask for Business Verification for some use cases; a plain Facebook Login app normally does not need it (check; if asked, tell me before you continue).
7. Copy App ID → `FACEBOOK_CLIENT_ID`, App Secret → `FACEBOOK_CLIENT_SECRET`.

What Facebook shows: "Contivo will receive: your name and profile picture, and email address." The person can untick the email, in which case we cannot create an account
and say so in plain words. Facebook does not tell us the email is verified, so Facebook sign-ups can never be merged into an existing account (see the spec, §5).

## What I need back from you

- "Google ready" / "GitHub ready" / "Facebook ready", each with the confirmation that the vars are set on Railway (never the values).
- For local testing: the local vars in your own `.env.local` in this worktree's `apps/web`. You do any real login yourself.
