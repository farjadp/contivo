# First post path: three concepts

Product design, 23 Nov 2026. Brief: `.claude/agent-org/work/strategy/2026-11-23-first-post-path.md` (section B).
Baseline: `.claude/agent-org/work/product/2026-11-23-first-post-path/journey-map.md`.
Mockups: `mockups/index.html`. Mockup content (company, competitors, post text, LinkedIn name) is **illustrative**, not real output.

**Today's baseline:** about 24 actions and 4 misdirections (header CTAs that lead to locked screens, the narrative detour, the connect step before any post exists, the OAuth return that leads nowhere). The walk took 6 min 48 s and reached a *scheduled* post with no channel. Nothing was published.

**Builds on:** PR #69 (journey-bugs session). Competitor save and keyword refresh update the page straight away. A successful OAuth connect lands on `/growth/[id]?connected=<platform>` with a notice and one button. With nothing published, that button opens the write-own-post editor (`?tab=pipeline&write=1`). Failures land on `/connections`. The Connect page lists every network, with planned ones disabled ("coming soon" + notify me).

---

## What all three share

**1. One next-step bar.** It is a single component in the dashboard layout, so it appears on Today, Workspaces, Connections, Settings and on the `?connected=` landing. It sits directly under the top nav and stays visible on scroll. It has:

- a step counter (`STEP 3 OF 5`), one line saying what to do (≤ 7 words), and an optional "why" (one sentence, ≤ 12 words);
- **one button with one verb**;
- during an AI wait, a progress line and no button, because there is nothing to click. This is the only state without a button.

It replaces the Setup guide, the "You are here" bar, the header CTAs and the Today "moves" list. The Loop rail is hidden until the first post. The bar is computed from one function, so no two places can disagree about what comes next. That function extends `buildJourney` with a `firstPost` end step that reads `publishedCount`, which exists today but nothing reads it.

**2. Hidden until the first post is published** (`publishedCount ≥ 1` on any workspace the user owns):

| Hidden | Where today |
|---|---|
| Header CTAs "Turn on Autopilot", "Ideate by hand" | `growth/[id]/page.tsx` header |
| 7 stat chips (competitors, content, discovery runs, AI calls, AI tokens, est. cost, tracked modules) | header |
| 6-card Setup guide + "You are here" | `JourneyGuide` |
| Loop rail | `LoopRail` |
| Sub-tabs: SEO Intelligence, Products & Services, Narrative, Calendar, Autopilot, Reports | tab strip |
| Matrices detail (charts, legend, dimension list): replaced by one line, "Market map ready · 3 charts · View" | Market tab |
| Ideation's 9 controls: the first post uses defaults (LinkedIn, Direct, no image) | Ideation tab |
| Today: "moves worth making", "Autopilot OFF", "competitors waiting" cards | `dashboard/page.tsx` |
| "Instant Content" in the top nav and the onboarding fork | nav, `/onboarding` |

Always hidden, not just before the first post (these are defects, not design): token/model telemetry on Keywords (W3) and "Fallback applied / mock" on Ideation (W4).

**How they unlock:** after the first publish, the published screen shows one line, "Your workspace is fully open", with the unlocked tools listed once. From then on the tab strip and the Loop rail are back, and the bar moves on to **"Let Contivo post every week → Set up Autopilot"**. After that it offers the Narrative ("Sharpen what you stand for"), as the step that improves Autopilot. A user can dismiss the bar once Autopilot is on.

**3. The journey ends at "first post published".** The last screen links to the live post through `SocialPublishJob.externalPostUrl`, which the LinkedIn adapter already returns. Autopilot is the step after.

**4. Publish now.** All concepts need a real "Publish now" for the first post. Today, Publish means "schedule for +4 h". The scheduler cron runs every minute (`social-scheduler.service.ts`), so scheduling at *now* publishes within about 60 s. The other option is a direct `POST social/publish-jobs`. Either way, the screen waits on the job status and shows the live link. "Schedule for later" stays as a secondary link.

**5. "Write it yourself" escape hatch.** On the draft screen in every concept, "Write my own instead" opens the write-own-post editor. It needs no intelligence, and publishing from it counts as the first post.

**6. Word budget per screen** (UI chrome only, not the post text): bar ≤ 20 words. Landing ≤ 90 words. Competitor confirm ≤ 60 words plus one evidence line per competitor. Draft screen ≤ 40 words around the post. Connect ≤ 35. Published ≤ 30. Today, the first workspace screen carries 898 words.

---

## Concept A: Guided rail, same order

**Idea.** Keep the chain and its order, and make it impossible to get lost in. The bar walks the user through brand → competitors → market map → keyword gaps → connect LinkedIn → first post → publish. The narrative moves to after the first post. Axes get defaults, so there is no pause to choose them ("Change axes" stays as a link). Ideation runs on defaults from the bar. **The connect step still comes before the draft.** That makes A the control for the value-before-the-ask test.

**Steps (sign-up → published):** sign up · company + domain → Analyze · *Confirm your competitors* (tick ≥ 2, save) · *Build your market map* (1 click, ~1 min) · *Find keyword gaps* (1 click, ~40 s) · *Connect LinkedIn* (Connect page → LinkedIn approve) · back via #69 · *Write your first post* (3 ideas → pick 1, ~30 s; draft ~20 s) · *Publish now* → live link.
**About 15 actions, 3 decisions** (which competitors, which idea, publish), **about 5–6 min**, 0 designed misdirections.

**Bar copy (en).** The counter in the mockups reads "Step n of 7" (brand, competitors, map, gaps, connect, first post, published); the brand step completes on its own during the analysis.

| Stage | Line | Button |
|---|---|---|
| No workspace | Add your company to start | Add company |
| Analyzing | Reading your website… about 10 s | (none) |
| 1 | Confirm your competitors | Review 7 found |
| 2 | Build your market map | Build map |
| 2 running | Mapping 3 competitors… about 1 min | (none) |
| 3 | Find the topics competitors miss | Find gaps |
| 4 | Connect LinkedIn to publish | Connect LinkedIn |
| 4 returned (#69) | LinkedIn connected. Write your first post. | Write my first post |
| 5 | Pick the idea to write up | (ideas list is the action) |
| 6 | Your first post is ready | Publish now |
| 6 running | Publishing to LinkedIn… under a minute | (none) |
| Done | Your first post is live | View on LinkedIn |
| After | Let Contivo post every week | Set up Autopilot |

**#69 landing:** works as built, but the button should read "Write my first post" and start the ideas step, not open an empty editor. Small follow-up to #69.

**Instant Content:** removed from the onboarding fork and the nav. `/instant` stays reachable for existing users and comes back in the unlocked tools.

**Code (high level):** `lib/workspace-journey.ts` (add `firstPost` and `published` steps, read `publishedCount`, move narrative and autopilot after) · new `NextStepBar` in the dashboard layout/`app-shell` · `growth/[id]/page.tsx` (hide the list above behind `hasPublished`) · `dashboard/page.tsx` · matrices flow (default axes, no pause) · `IdeationTab` quick mode · publish-now in `actions/calendar.ts` / pipeline · `messages/{en,fa}/workspace.json`. **Server gate: no change.** Size **S–M**.

**Risks.** The ask still comes before the value. Asking for LinkedIn access before showing a word of output is where the walk broke, and it may stay the biggest drop. There are three separate AI waits the user has to start, and each is a place to leave. The user still sits through "intelligence" they did not ask for before seeing what it buys.

**Riskiest assumption.** A tests *path clarity alone*. If teams still stall, look at where. A stall at *Connect* mixes up trust in Contivo with trust in the content, because they have not seen a post yet, so A cannot cleanly separate the two. A stall between "first post ready" and "Publish now" points at content.

---

## Concept B: Value before the ask (recommended)

**Idea.** After the brand analysis, ask the user to confirm their competitors on one screen, then do everything else for them. One server-side run builds the market map (default axes), runs the keyword gaps, ideates and writes one full LinkedIn draft. It shows honest progress, with each finished step stating what it found. The user lands on **their first post**. Only then does the bar ask: *Publish this on LinkedIn → Connect LinkedIn*. OAuth returns to that same draft with *Publish now*. The intelligence screens (market map, keywords) stay reachable from the draft as **"Why this post"** links. After the first post they come back as tools that improve your posts.

**Competitors are not auto-accepted.** The AI's guesses are shown with one evidence line each (the source page they were found on), and none are ticked in advance. Pre-ticking guesses would put unconfirmed data into the chain and break the "never invent" rule. The user ticks ≥ 2. That is the one real decision before the draft.

**Steps:** sign up · company + domain → Analyze (~10 s) · **one screen:** tick ≥ 2 competitors → *Write my first post* · progress, ~2–3 min (map → gaps → idea → draft) · read the draft (optional: edit, other angle, write my own) · *Connect LinkedIn* · LinkedIn approve · back on the same draft · *Publish now* → live link.
**About 9 actions, 3 decisions** (which competitors, keep this draft, publish), **about 4 min** (most of it waiting while the progress screen shows what was found), 0 designed misdirections.

**Bar copy, en + fa** (fa written for Persian readers, not translated: formal-but-human, «شما» carried by the verb)

| Stage | en: line · button | fa: line · button |
|---|---|---|
| No workspace | Add your company to start · **Add company** | برای شروع، شرکتتان را اضافه کنید · **افزودن شرکت** |
| Analyzing | Reading your website… about 10 s | در حال خواندن سایت شما… حدود ۱۰ ثانیه |
| 1 | Confirm who you compete with · **Confirm competitors** | رقبای واقعی‌تان را انتخاب کنید · **انتخاب رقبا** |
| 1 why | Your first post is written against them. | پست اولتان با نگاه به همین‌ها نوشته می‌شود. |
| 2 running | Writing your first post… about 2 min | در حال نوشتن پست اول شما… حدود ۲ دقیقه |
| 3 (off the draft) | Your first post is ready · **Read it** | پست اول شما آماده است · **خواندن پست** |
| 3 (on the draft) | Publish this on LinkedIn · **Connect LinkedIn** | این پست را در لینکدین منتشر کنید · **وصل کردن لینکدین** |
| 3 why | Your personal profile. Nothing posts until you press Publish. | در پروفایل شخصی شما. تا «انتشار» را نزنید، چیزی منتشر نمی‌شود. |
| 4 returned | LinkedIn connected. Publish your first post. · **Publish now** | لینکدین وصل شد. پست اولتان را منتشر کنید. · **انتشار همین حالا** |
| 4 running | Publishing to LinkedIn… under a minute | در حال انتشار در لینکدین… کمتر از یک دقیقه |
| Done | Your first post is live · **View on LinkedIn** | پست اول شما منتشر شد · **دیدن در لینکدین** |
| After | Let Contivo post every week · **Set up Autopilot** | بگذارید Contivo هر هفته برایتان پست بگذارد · **راه‌اندازی اتوپایلت** |

**#69 landing:** with an AI draft waiting, the button must read **"Publish this post"** and open *that* draft in the publish state, not the empty write-own-post editor. Small follow-up to #69: route to `first-post` when a first-post draft exists, otherwise keep today's behaviour.

**If the run fails** (an AI provider is down, or the gate refuses), the bar says what failed and offers one retry: "Keyword gaps didn't finish · **Try again**". The steps that did finish are kept. "Write my own instead" stays available.

**Instant Content:** removed from the fork. `/onboarding` goes straight to "Your company". B *is* the fast track, and it publishes.

**Code:** everything in A's list (bar, hiding, journey end, publish-now), plus a new server action `startFirstPost` that orchestrates the existing matrices (default axes) → keywords → ideation (1 idea, LinkedIn, Direct, no image) → preview. Its run state is stored so a closed tab resumes. It is a new `first-post` view in the workspace (`?tab=first-post` or `/growth/[id]/first-post`), with a progress screen that streams each step's real result. **Server gate: no change.** The draft is grounded on exactly what it is grounded on today: Brand Memory, matrices that pass `matricesGate`, and keyword intel. Size **M**. Needs head-of-data to confirm that default axes do not weaken the matrices.

**Variant B-lite (not recommended now):** draft straight from Brand Memory, competitors afterwards, which cuts about 2 min. **Needs the ideation gate relaxed, plus engineering and head-of-data sign-off on draft quality.** That draft would be grounded only on the brand's own site, with no competitor angle, which is exactly the generic content the product promises to avoid.

**Risks.** A wait of 2–3 minutes with nothing to do; the progress screen has to earn it by showing findings, not a spinner. If the run fails halfway, the user meets the error with no context. The user never chooses axes or reads charts, so the "intelligence" story is less visible. The "Why this post" links have to carry it. The run uses credits (matrices, keywords, ideation, preview). I don't know the exact total. It must fit the 100 starting credits, with no image by default.

**Riskiest assumption: the cleanest test.** Everyone who confirms competitors reaches a full draft with no further choices, so the funnel splits cleanly into three steps:

- *draft shown → Connect clicked*: content and trust. If they read it and stop here, the problem is the post, not the path.
- *Connect clicked → connected*: LinkedIn permission or OAuth trust.
- *connected → published*: the last-mile UI.

Also log edits before publish (how much was changed) and "other angle" or "write my own" clicks. Heavy edits or switching to their own text means low trust in AI posts, even when they do publish.

---

## Concept C: First-post wizard

**Idea.** A separate full-screen flow with no app chrome, in five steps: **Confirm your brand → Confirm competitors → Pick one of 3 drafts → Connect LinkedIn → Publish.** The workspace opens only after the post is live. "Skip to workspace" is offered from step 1, and the bar then reads "Finish your first post · Continue".

**Steps:** sign up · company + domain → Analyze · **1** check pillars and tone (edit inline) → *Looks right* · **2** tick ≥ 2 competitors → *Next* · wait ~3 min (3 drafts) · **3** pick one of 3 full drafts (edit) → *Use this one* · **4** *Connect LinkedIn* · approve · back into the wizard · **5** *Publish now* → live → *Open my workspace*.
**About 11 actions, 4 decisions** (brand right, competitors, which draft, publish), **about 5–6 min** (3 drafts take longer to write and to read).

**Bar copy (en).** Outside the wizard (Today, Connections, `?connected=`): `STEP n OF 5 · Finish your first post · Continue`. Inside the wizard, the step header is the bar: "Is this your brand?" · "Who do you compete with?" · "Pick your first post" · "Connect LinkedIn to publish it" · "Publish your first post" · "Your first post is live · View on LinkedIn".

**#69 landing:** OAuth `return` must point at the wizard step 5, not `/growth/[id]`. This is a follow-up to #69 (a new return target).

**Instant Content:** replaced by the wizard. The onboarding fork becomes a single path.

**Code:** A's bar, journey end and publish-now, plus a new route `(onboarding)/first-post/[step]` with wizard state in the DB, a brand-confirm screen (editing Brand Memory), 3 full previews (3× the AI calls and roughly 3× the credits of one), the OAuth return target, and a redirect guard ("no published post → wizard") on `/growth/[id]` and `/dashboard`. **Server gate: no change.** Size **L**. It is a second UI for the same chain that has to be maintained alongside the workspace.

**Risks.** The cliff: after the wizard, the user drops into the full workspace they never learned. Duplicate UI. The 3-draft wait is the longest. Step 1 adds a decision most users will click through, though it is the one place they check what Contivo "thinks" of them, which may build trust. The redirect guard can trap users who want to look around.

**Riskiest assumption.** The strongest content signal: if none of 3 drafts is picked, the content is the problem, unambiguously. Picking one and stalling at Connect means trust or permission. But the wizard changes the path *and* the shape of the product at once, so a success does not tell you whether the in-app path would have worked.

---

## How each handles the drop-offs in the journey map

| Drop-off (journey map row) | A | B | C |
|---|---|---|---|
| #2 Fork; Instant Content leads nowhere (W6) | fork removed | fork removed; B is the fast track | wizard replaces it |
| #5 Lands on the step already done; next step is 5th on the page | bar at top, one action | bar + lands on competitor screen | wizard step 1 |
| #6 Market content starts at y=827; disclaimer repeated 7× | Market tab opens on the list; one disclaimer | one-screen confirm, one disclaimer | wizard step 2 |
| #7 Axes decision | defaults | defaults | defaults |
| #8 No "next" near the charts | bar is sticky | charts not shown before the post | not shown |
| #10 Four competing "next" destinations | one bar, rest hidden | same | wizard has no app chrome |
| #11 Narrative detour | moved after the first post | same | same |
| #12 Connect before value | **still before** (control) | after the draft | after the draft |
| #14–15 Draft modal has no publish; "Added to Pipeline" leads nowhere | draft opens in publish state | draft *is* the screen | step 3 → 4 |
| #17 Publish with no channel schedules silently (W2) | can't happen: connect comes first | Publish button only after connect | same |
| #18–19 OAuth return dead end; next = Autopilot | #69 + bar "Write my first post" | #69 → **this draft** (follow-up) | #69 → wizard step 5 (follow-up) |
| Today shows 4 calls to action | the bar only | the bar only | the bar only |

---

## Comparison

| | Today | A Guided rail | **B Value before the ask** | C Wizard |
|---|---|---|---|---|
| Actions to first post | ~24 + 4 misdirections | ~15 | **~9** | ~11 |
| Decisions to first post | ~10 (fork, axes, narrative ×3, 9 ideation controls…) | 3 | **3** | 4 |
| Minutes (estimate) | 6 m 48 s to *scheduled*, never published | 5–6 | **~4** | 5–6 |
| Engineering size | | S–M | **M** | L |
| Server gate change | | no | **no** (B-lite: yes) | no |
| Risk to draft quality | | none | low (default axes; head-of-data check) | none per draft; 3× cost |
| Separates path vs. content | | weakly | **cleanly** | strongly, but confounded by the new shape |
| Reversibility | | high (bar + hiding behind a flag) | **high** (flag; tabs untouched) | low (new route + redirect guard) |

## Recommendation: B

1. **It is the only concept that puts the value first without relaxing the gate.** The draft rests on the same evidence as today. The user simply stops doing the plumbing by hand.
2. **Fewest decisions (3) and actions (~9).** For mentee teams with no help, every manual AI wait in A is a place to leave.
3. **It tests the riskiest assumption cleanly.** Everyone reaches a draft, so draft → connect measures content trust and nothing else.
4. **It is reversible.** It is one new view plus the bar, behind a flag, and the existing tabs stay as they are. A falls out of it for free: the bar and the hiding are shared, so if B's orchestration slips, ship A's half first.

Not C: it costs the most, duplicates the UI, and leaves the user at a cliff when they enter the workspace afterwards.

**Owners outside product design:** final screen specs → contivo-ux-ui-designer. Orchestration, publish-now and the #69 follow-up → contivo-cto. Default axes and credit total → contivo-head-of-data. Funnel events `first_post.stage` → contivo-head-of-data.
