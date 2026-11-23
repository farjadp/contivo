# Journey map: sign-up → first published post (as it really runs, 23 Nov 2026)

Walked by contivo-cpo on a fresh local account (`journey-walk@contivo.local`, local DB only), code at
origin/main `41723f8`, en locale, 1280×900. Brand: www.contivo.app. Screenshots in `walk/` (this folder).
Timings come from that account's `activity_logs` rows (the funnel tracking on main works locally).

Total: **6 min 48 s and ~24 actions** from sign-up to a *scheduled* post — by someone who already
knew the path, with fast AI responses. No channel was connected, so nothing would publish.

## The walk, screen by screen

| # | Screen (URL) | What the user meets | Decisions / actions | Text weight | Problems seen |
|---|---|---|---|---|---|
| 1 | Sign-up `/sign-up` | Name, email, password | 1 form | light | — |
| 2 | Onboarding fork `/onboarding` (shot 01) | "Begin shaping your system." Build Workspace (recommended) vs Instant Content (fast track) | **Fork #1** | medium, abstract ("construct your long-term strategy") | Instant Content has no workspace and **no publish path** — a dead end for activation. Different visual style from the app. |
| 3 | Build workspace `/growth/new` (02) | Company name + domain → Analyze | 2 fields | light | — |
| 4 | Analyzing `/growth/analyzing` (03) | 4-phase progress, ~10 s | wait | light | Good. |
| 5 | Workspace, Brand Memory tab `?tab=strategy` (04) | Header with **2 CTAs that lead to locked screens** ("Turn on Autopilot", "Ideate by hand"), **7 stat chips** (AI calls, AI tokens, est. cost…), 6-card Setup guide + "You are here" bar, 6-stage Loop rail, sub-tabs, then Brand Memory content (pillars, tone, "Refresh Brand Assets", "Rescrape Website") | ~15 clickable targets above the fold; **lands on the step already done**, not on the next one | heavy: 898 words on the page | The next step is the 5th thing on the page. |
| 6 | Market tab `?tab=matrices` (05) | Tab content starts at **y = 827 px** (below the fold on 900 px). 7 AI-guessed competitors, each with Add / Set aside / Type and the **same 40-word disclaimer repeated 7×** | accept ≥ 2 | heavy: 720 words in the tab | After accepting 2, the guide updates but **"Build matrices" stays disabled ("No competitors to build on yet") until reload** — Farjad's bug #2 (A-fix, other session). |
| 7 | Build matrices → **choose axes** (09) | Pauses to ask the user to pick 2–3 of 4 axis pairs and optionally rename them | **Decision nobody asked for** | 170 words | Jargon ("Offer breadth and specialisation", "Content presence and focus"). |
| 8 | Charts done (10) | 4 charts, legend, dimension list | read | heavy | **No "next" near the user**: the guide bar is ~800 px above. |
| 9 | Keywords `?tab=keywords` (11) | "Analyze Competitor Keywords", then keyword lists, intent %, and **"LAST KEYWORD RUN TOKENS / Prompt / Completion / Model: gpt-4.1"** shown to the customer | 1 click | medium | **Guide still says "Run keyword analysis" after it finished, until reload** — same class as bug #2 (reported to the bug session). |
| 10 | After keywords (the point Farjad called unclear) | Guide says "Decide what you stand for → Draft the narrative". At the same time the header says **Turn on Autopilot** and **Ideate by hand**, the Loop shows Pipeline / Calendar / Reports **open**, sub-tabs offer SEO Intelligence and Products & Services | **4 competing "next" destinations** (Narrative, Ideation, Pipeline, Autopilot) + 3 side sections | — | This is the "several sections, no single direction" moment. |
| 11 | Narrative `?tab=narrative` (12) | 3-part form: "What is changing in your customers' world?", "What can you actually prove?" (claim types), storylines | propose → pick 1 of 3 → save → draft storylines | **724 words** after drafting | A strategy exercise. Not required for a manual post (ideation gate is matrices + keywords), only for Autopilot. |
| 12 | After narrative | Guide jumps to **"Connect an account or add a site"** — sends the user out to `/connections` **before they have seen a single post** | — | — | The ask comes before the value. |
| 13 | Ideation `?tab=ideation` (13) | 9 controls: Goal (7), **Platform (7 incl. Email, Ad copy, Landing page — none publishable)**, Funnel (TOFU/MOFU/BOFU), Framework (6), ideas, words, image (3 credits), Auto Calendar, Direct vs Source Form | defaults work | 150 words | Results show "**Overall Score 1.00/10 · Fallback applied · Calendar: Auto insert (mock)**" (B14, still live). Each idea has 2 buttons: Generate Preview / Add to Pipeline. |
| 14 | First full draft (14) | Preview modal, "This draft passed the quality check" — **the first moment of value, ~6 min in, inside tab 3 of 6** | only "Close" | — | No "publish this" in the modal. |
| 15 | Add to Pipeline | Button turns "Added to Pipeline"; user stays on Ideation | navigate manually | — | No link to the pipeline. |
| 16 | Pipeline card `?tab=pipeline` (15) | Status GENERATED, preview, image (make 3 credits / upload), Quick Publish Schedule (date, time, TZ, **Publish**), Refine with your own source, Edit, Approve Concept, **second Publish** | 2 Publish buttons + Approve Concept | medium | "Publish" means "schedule for +4 h by default" (admin setting). |
| 17 | Publish with **no channel connected** (16) | Silently scheduled; jumps to Calendar; card says LINKEDIN · SCHEDULED | — | — | **No warning that nothing is connected.** At the due time the scheduler fails it with `NO_CONNECTION` (`social-scheduler.service.ts`) unless LinkedIn was connected in between. New defect. |
| 18 | Connections `/connections` (08) | Global page (no workspace context), Social / Websites, 4 sub-tabs (Accounts, Rules, Queue, History), "Connect your first account" | connect | light | After OAuth the user returns here (or to the default workspace, B17) — **the path stops** (Farjad's bug #3; A-fix). |
| 19 | After connect | Guide's next step is **"Turn on Autopilot"** — never "publish your first post" | — | — | See "structural cause". |

The **Today** dashboard (07) adds its own list: "2 moves worth making this week" (Map the market, Put
something on the calendar) + "5 competitors are waiting — Review them" + "Autopilot OFF — Set up
Autopilot": four calls to action that do not agree with the workspace guide's single step.

## Structural cause (from the code, confirmed on screen)

1. **The journey has no "first post" step.** `lib/workspace-journey.ts` defines six setup steps:
   brand → market → keywords → narrative → channel → autopilot. "Setup complete" = Autopilot on.
   `publishedCount` is in `WorkspaceFacts` but nothing reads it. The product's own model of
   success is "configured", not "published".
2. **The first draft is gated behind four AI setup steps** (brand, ≥2 accepted competitors,
   matrices incl. an axes choice, keywords). The narrative is not needed for a manual post but
   the guide puts it before everything else.
3. **The ask (connect) comes at step 5, before any post exists**, and leads off to a global page
   with no way back.
4. **Five things compete to say what is next**: setup guide, "You are here" bar, Loop rail,
   header CTAs, Today dashboard. They are built from the same module but present different
   things (header always pushes Autopilot + Ideation, whatever the state).
5. **Text**: ~900 words on the first workspace screen; repeated disclaimers; internal telemetry
   (tokens, model, cost, "Fallback applied", "mock") shown to customers.

## Defects found on the walk (not design; for the fix queue)

| ID | Defect | Owner |
|---|---|---|
| W1 | Keywords finished, guide stays stale until reload (same class as competitor-save) | reported to journey-bugs session (`local_96c296c1`) |
| W2 | Publish with no connected channel schedules silently; fails later with NO_CONNECTION | new — CTO queue |
| W3 | Keyword tab shows prompt/completion tokens + model name to customers | new — CTO queue |
| W4 | Ideation shows "Overall Score 1.00/10 · Fallback applied · Calendar: Auto insert (mock)" (B14) | known, still live |
| W5 | Ideation Platform list offers Email / Landing Page / Ad Copy / Strategy Note, which cannot publish | new — product decision |
| W6 | Instant Content path has no workspace and no way to publish | design (covered by concepts) |
