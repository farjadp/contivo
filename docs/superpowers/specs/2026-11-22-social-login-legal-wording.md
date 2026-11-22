# Social sign-in: English legal wording (canonical)

Draft by the legal-compliance specialist, 22 Nov 2026. Not legal advice; section 4 lists what needs a lawyer.
Targets `apps/web/messages/en/legal.json`. `{email}` and `{entity}` are filled by `fillIdentity()`. Edits are keyed to JSON paths as they stand on this branch.

## 0. Findings that change the brief

1. **No self-service deletion exists.** Grep of `apps/web/src` and `apps/api/src`: the only delete is an admin-only workspace delete (`actions/admin.ts` `WORKSPACE_DELETED`). There is no user-delete action, no Settings control, no API route. Deletion today = Farjad deleting the user row by hand. The copy below is true as "write to us"; it must not say "delete it in Settings".
2. **The cookies section becomes false.** `legal.privacy.sections[id=cookies]` says Contivo "sets three cookies". The spec adds `oauth_tx` (10 minutes, deleted at callback) and, on a refused match, `oauth_pending` (10 minutes). Both are needed for sign-in and are short-lived, so the "no tracking, no banner" claim survives, but the count and list must change (edit 1.7).
3. **The security section says connected-account tokens are encrypted.** Still true. Provider sign-in tokens are not stored at all (spec section 7), so no change, but do not merge the two claims.
4. **Deletion order matters for the identity rows.** `OAuthAccount.userId` is `onDelete: Cascade` (spec section 8), so deleting the user row removes them. The statement in `delete-account` depends on that holding. Whoever deletes accounts by hand must delete the *user*, not just workspaces.
5. **The existing `rights` line "disconnect LinkedIn or X ... deletes the token" is unchanged.** Unlinking a sign-in provider (Settings) is a separate thing; edit 1.8 covers it.

## 1. Privacy page: edits

### 1.1 `legal.privacy.meta.description`
Replace with:
"What Contivo collects, which providers process it, the cookies it sets, and how to have your data deleted."
(Drops the number "three"; the list now varies by sign-in method.)

### 1.2 `legal.privacy.summary` (insert after index 1, becomes new index 2)
"If you sign in with Google, GitHub or Facebook, we receive your name and email and keep no access to your account there."

Existing items stay as written. Check against item [1] "set no tracking or analytics cookies": still true (see 1.7). Existing item [3] (now [4]) "Write to {email} and we delete your account and workspace within 30 days." stays true.

### 1.3 `sections[id=collect].blocks[1]` (the bullet list): insert after the "Account:" item
"Sign-in with Google, GitHub or Facebook: if you use it, your name and email address as that provider reports them, and the provider's own ID for your account. We also record which provider it was, whether the provider says the email is verified, and when you first and last signed in this way. We copy your name once, when the account is created. We never receive or store your password for that provider, your contacts or friends, your posts, or your profile picture, and we keep no token that gives us access to that account."

(Length is above the other bullets; if it must be shorter, split the last sentence into a second bullet: "Sign-in with a provider never gives us your contacts, friends, posts or picture, and we keep no access token.")

Also amend the "Account:" item? Not needed: "your email address ... and your password" is true for password accounts. Optional tidy: "your password, if you use one."
Replacement: "Account: your email address, your name if you give one, and your password if you use one. The password is stored only as a one-way hash; we cannot read it."

### 1.4 `sections[id=use].blocks`: add after index 0
"To let you sign in: with the provider you chose, or with your email and password. Signing in with a provider is optional; email and password keep working."

### 1.5 `sections[id=providers].blocks[1]` (list): insert after the "LinkedIn and X:" item
"Google, GitHub (owned by Microsoft) and Facebook (Meta): only if you choose to sign in with them. They act as identity providers for sign-in and nothing else. They learn that you signed in to Contivo, and they handle that sign-in under their own privacy policies. We send them nothing from your workspace."

Check "nothing from your workspace": the authorize request carries only state, scopes, redirect, PKCE challenge (spec section 4). Verified against spec, not against running code (not built yet).

### 1.6 `sections[id=providers].blocks[2]`
Existing "Some of these providers store or process data outside Canada, including in the United States." stays true and now also covers these providers. No change. (See 4.1.)

### 1.7 `sections[id=cookies]`
Replace `blocks[0]` with:
"Contivo sets three cookies, all needed for the site to work:"
(unchanged) and replace `blocks[2]` with:
"If you sign in with Google, GitHub or Facebook, two more short-lived cookies may be set while the sign-in completes: one that carries the sign-in from our site to the provider and back (deleted when it finishes, and gone after 10 minutes at most), and one that, if your email already belongs to an account, holds the pending connection for 10 minutes while you sign in with your password. Neither tracks you.
No advertising cookies, no analytics cookies, no third-party trackers. That is why there is no cookie banner."
(Two separate strings in the blocks array: put the first as a new paragraph before the closing sentence.)
Names are not listed, to match "three cookies" style only if the list is kept; add `oauth_tx` / `oauth_pending` as list items instead if Farjad prefers naming them, as the existing list does. I recommend naming them for consistency:
- list item: "oauth_tx: carries a provider sign-in from our site to the provider and back. Deleted when it finishes, or after 10 minutes."
- list item: "oauth_pending: set only if your email already belongs to a password account; lets you connect the provider after signing in with your password. 10 minutes."
and change `blocks[0]` to "Contivo sets three cookies for the site to work, and two more short-lived ones if you sign in with a provider:". Verify cookie names and lifetimes against the built code before release (assumed from spec).

**COO review: final decision for 1.7 (supersedes the ambiguous text above).** Implement the "name them" variant:
- `blocks[0]` = "Contivo sets three cookies for the site to work, and two more short-lived ones if you sign in with a provider:"
- list = existing three items + the two list items above (`oauth_tx`, `oauth_pending`).
- `blocks[2]` unchanged ("No advertising cookies ... no cookie banner."). Do not add the extra paragraph.
- Meta description (1.1) drops "three" accordingly. Confirm names/lifetimes against built code.
- 1.9 first block: "Contivo is a content-marketing service" is not a phrase used elsewhere on the page; engineers may shorten to "Contivo is run by {entity}." to match the `who` section.

### 1.8 `sections[id=retention].blocks`
Replace `blocks[0]` with:
"As long as your account exists. Ask us to delete it and we delete your account, workspaces, content, connected-account tokens and sign-in records (provider, provider account ID and email) within 30 days. How to ask is in the next section."
Keep `blocks[1]` unchanged.

### 1.9 NEW section `delete-account` (insert after `retention`, before `rights`)
```json
{
  "id": "delete-account",
  "title": "How to delete your account and data",
  "blocks": [
    "This applies to everyone, including people who signed in to Contivo with Google, GitHub or Facebook. Contivo is a content-marketing service run by {entity}. If you signed in to it with one of those providers and want your data deleted, this is how.",
    "Send an email to {email} from the address on your account, and say you want your account deleted. If you signed in with a provider and are not sure which address we hold, tell us the provider and we will find it. We may ask one question to confirm the request is yours. We do not need your password.",
    "Within 30 days we delete:",
    [
      "your account and your workspaces;",
      "everything Contivo built or stored for you: brand memory, competitors, strategy, drafts and published content;",
      "the connected-account tokens (LinkedIn, X) and any site key;",
      "your sign-in records: the provider, the provider's ID for your account, and the email it reported."
    ],
    "We then write back to confirm it is done. Two exceptions: payment records we must keep by law stay for as long as the law says, and posts already published on LinkedIn, X or your own site stay there until you remove them on those platforms.",
    "You can also remove Contivo from your Google, GitHub or Facebook account yourself, in that provider's settings under connected apps, third-party apps or apps and websites. We hold no access token for your account there, so this changes nothing on our side. It only clears Contivo from your list at the provider."
  ]
}
```
Notes: "run by {entity}" mirrors the `who` section. "from the address on your account" is a verification choice; if the user registered via Facebook with no email, there is none (we refuse unverified-only creation unless the email is present, per spec rule 3, but the stored email may be unverified). Hence the "tell us the provider" sentence, and we then need a way to verify: unsure, see section 4.

### 1.10 `sections[id=rights].blocks`: add after index 1
"If you sign in with a provider, you can disconnect it in Settings, as long as another way to sign in remains. That removes the record we hold for that provider. Deleting the whole account is described above."

### 1.11 `legal.privacy.intro`
No change needed. `headline` no change. `common.links.privacy.body` ("...how to get it deleted") already matches.

### 1.12 `legal.privacy.sections[id=children]`
No change; see 4.7 for the age question.

## 2. Terms

`legal.terms.sections[id=account].blocks`: append a second block after the existing one:
"If you sign in with Google, GitHub or Facebook, that provider's own terms apply to your use of its sign-in. Signing in with a provider creates a Contivo account under these terms if you do not already have one."

`sections[id=networks]` is for publishing networks (LinkedIn, X, own site); do not put sign-in providers there, because the section's last sentence ("publishing through Contivo may stop") is about publishing.

`sections[id=agreement]` already says "The Privacy page is part of this agreement." Keep. `legal.terms.intro` says "By creating an account you accept them." That already covers the sign-in case in wording; no change.

`sections[id=ending].blocks[0]` ("ask for your account to be deleted at any time") stays true, as written. Optionally add: "Instructions are on the Privacy page under How to delete your account and data." Recommended, so Terms and Privacy do not drift.

## 3. Fine print under the sign-in buttons (sign-in and sign-up pages)

"By continuing you agree to our <terms>Terms of use</terms> and <privacy>Privacy page</privacy>, and an account is created if you do not have one yet."

One sentence. True on both pages. It works as notice that sign-in can create an account; see 4.4 for why it is not equivalent to a checkbox.

## 4. Points for a lawyer or for us

| # | Point | Class | Position / action |
|---|---|---|---|
| 4.1 | Cross-border: identity data goes to Google, Microsoft (GitHub) and Meta, mostly US-based. PIPEDA has no transfer ban but requires accountability and openness (tell users data may be processed abroad and accessible to foreign authorities). The Privacy page already says this for other providers (`providers` block). Edit 1.5 relies on that sentence. | informational, plus lawyer if we market to the EU | We are not the transferor to them: the user initiates sign-in with the provider. No contract with these providers is needed from us beyond their developer terms. If EU/UK users are targeted, Contivo needs a GDPR analysis (Art. 3, 13, 27 representative, SCCs for our processors). Needs lawyer before an EU push. |
| 4.2 | Retention of `oauth_accounts` rows after deletion. | needs action by us | Our position: delete them with the user (cascade, spec section 8), and the copy says so. The residual risk is that deletion is a manual DB step today. Action: make the runbook "delete the user row" and test that the cascade removes identity rows on a copy of the schema. Backups hold data until they roll off; the Privacy page does not mention backups. Needs lawyer to decide whether to say so (Neon retention window is a fact we have not looked up). |
| 4.3 | Lawful basis and consent. | needs lawyer | PIPEDA: knowledge and consent; clicking a provider button after seeing the fine print is likely implied-consent for identity data needed to sign in, with the Privacy page as the notice. GDPR (if applicable): contract performance (Art. 6(1)(b)) is the natural basis; no consent needed for sign-in data. I believe this is reasonable; I am not able to confirm. |
| 4.4 | Terms acceptance by clicking ("browsewrap"). Today the password sign-up page also has no checkbox (intro says "By creating an account you accept them"); the fine print is the same pattern, placed next to the action. | needs lawyer | Courts in Canada have enforced clear notice next to the action more readily than a footer link, so the placement is the right one. A checkbox is the safer option but costs conversion and cannot exist on a sign-in that silently creates an account. Risk: low-medium. Interim: keep fine print visible, not collapsed, not below the fold on mobile. |
| 4.5 | Meta platform terms: data-deletion. Meta requires either a Data Deletion Request Callback URL or a Data Deletion Instructions URL for apps using Facebook Login. | needs action by us | We choose the instructions URL: `https://www.contivo.app/en/privacy#delete-account` (locale prefix per the app's routing; confirm the exact public path). Meta's form accepts a URL; I believe a fragment is allowed since it is just a URL, but I have not tested it. If Meta rejects the fragment, fall back to a dedicated route `/delete-account` that renders the same section. Must be publicly reachable, without login, and in a language reviewers read (English). The URL must work before the app is submitted for review. Also required by Meta: a public Privacy Policy URL for the app, and a Terms URL is recommended. |
| 4.6 | Google OAuth verification. Sign-in only requests `openid email profile`, which are non-sensitive scopes: no sensitive-scope verification or security assessment needed, but brand/domain verification and a published privacy policy that names the data are required to leave "Testing" and to remove the unverified-app screen. Limited Use applies to restricted/sensitive Google user data (Gmail, Drive, etc.), not to basic sign-in profile data, as far as I know. | informational, unsure | I did not check Google's current requirements in this session; confirm on the Google Cloud console consent screen page before submitting. Google also requires the homepage link and privacy link on the consent screen to be on a domain we verify. |
| 4.7 | Age gate. Terms say 16+. Providers give no age assurance. Google, GitHub and Facebook enforce their own minimum ages (13 or local), lower than our 16. | needs lawyer | A 14-year-old with a Google account can create a Contivo account. This is the same exposure as password sign-up today (self-declared). The Terms `account` line "You must be at least 16" covers contractual position. PIPEDA does not set a fixed age. Position: accept as is, unless we target minors (we do not). |
| 4.8 | Must the Privacy page be updated before provider apps are submitted? | needs action by us | Yes. Google, GitHub and Meta reviewers read the policy URL; Meta checks that it mentions the data collected through Login and deletion. Release order: legal copy (en at least) live on www.contivo.app, then submit apps for review. The other locales follow in the same PR per spec section 10. |
| 4.9 | Account deletion is manual and the 30-day promise depends on one person. | needs action by us | Not new, but social sign-in increases requests (Meta users arrive with no context). Needs: an owner for the inbox, a runbook, and ideally a self-service delete before volume. This is a product ask for contivo-cpo, not legal wording. |
| 4.10 | Verifying a deletion request when the user signed in with Facebook and we hold no verified email. | needs lawyer | If the requester cannot prove control of the stored account (no verified email to reply to), deleting on an email claim alone could delete someone else's account. Recommended: reply only to the stored address and delete only after a confirmation reply or a fresh sign-in by the requester. Wording above (1.9) leaves "one question to confirm" flexible. |

## 5. Unsure

- Whether Meta accepts a URL with a `#fragment` as the Data Deletion Instructions URL (not tested; fallback in 4.5).
- Whether the locale-prefixed path is acceptable to Meta or a locale-less URL must exist (check redirect behaviour).
- Current Google OAuth verification requirements for `openid email profile` (4.6).
- Exact cookie names, lifetimes and "oauth_pending" behaviour: taken from the spec, not from built code (edit 1.7).
- Backup retention at Neon/Railway and whether to disclose it (4.2).
- Whether GDPR applies (no EU targeting confirmed in the brief).
- Whether "GitHub (owned by Microsoft)" is the legal identity to name; GitHub, Inc. is the contracting party. Naming both is accurate as of my knowledge; a lawyer should confirm.
- Persian/other-locale legal wording: out of scope here; each must be written natively per spec section 10.
