# Home page: result first (direction A)

Decided by Farjad, 22 Nov 2026, from three directions (A result first, B the Loop shortened, C sample first).

## Problem
- The home page explained the mechanism (lock, judge, gate) before the result. A small-business owner had to read past it to learn that posts go out on their LinkedIn and their own site every week.
- It was 11,479px on a phone (about 14 screens). "The refusal" alone was 2,056px.
- Nav items were in-page anchors with internal names ("Intelligence", "The refusal", "Autopilot"). The real pages (/product, /why, /compare) were not in the nav.
- There was no price on the page, no "who it is for / not for", no FAQ, and no real output shown.

## Structure (top to bottom)
1. **Hero:** the result in one sentence, the URL field (unchanged), and the hint about the sign-up. The visual is the **real pipeline capture** (`/marketing/generated-post.webp`, Puppeteer capture of a real workspace, 26 Sep), captioned as such.
2. **What a week looks like:** three plain facts (1–14 posts a week; LinkedIn profile and your own site; the next 7 days planned), plus the existing cadence demo (`CadenceWeek`).
3. **How it works, in three steps:** Read your site → research your market → write and publish. Each step uses a real capture (brand memory, market map, pipeline) and links to /product.
4. **Why it won't read like AI:** the lock and the quality gate, condensed into one section. It keeps the existing hard-check and judge lists and links to /why and /compare.
5. **The 22-second film:** the existing `ProductReel`, unchanged.
6. **For you / not for you yet:** reuses the `why` namespace strings, so the two pages cannot disagree.
7. **Pricing in brief:** the three plans from `lib/plan-catalogue.ts`, the early-access line, and a link to /pricing.
8. **FAQ:** five questions. Does it publish without me? Which channels? Which languages? What does it cost? What do I need?
9. **Close:** the existing closing CTA.

## Removed from home (still elsewhere)
The Loop ring, the six chapter sections, the run log, the setup chain, and "Try the lock". They live on /features and /product, or are condensed into section 4.

## Nav (every marketing page)
How it works (/product) · Why Contivo (/why) · Compare (/compare) · Pricing (/pricing) · Blog (/blog). Footer anchors that pointed at removed home sections now point at /product and /features.

## Rules
- No claim beyond what CONTEXT.md and the code support. Channels are LinkedIn personal profiles and your own site; X, Telegram, WordPress and Threads are "soon". Approval is off by default.
- No invented output. The only output shown is the real capture, labelled as a real workspace.
- Persian is written natively. All 8 locales ship: fr/ar/zh are site-only, so the marketing namespace must exist for them.
- Target was under 6,000px on a phone in en. Result: 8,066px at 375px (6,622 of page plus the shared 1,444px footer), down from 11,479. The rest would have cost proof (the captures), so it stays. Phones get a shorter cut: the cadence demo, the repeated hero capture in step 3, the third and fourth items of each refusal list, and the for/not-for explanations are tablet-and-up; FAQ answers are native `<details>` (still in the HTML).
- No horizontal scroll at 320/375/768/1024/1280 in all 8 locales, RTL tested with scrollTo(-500); the header stays one line (64px) everywhere.

## Open, for Farjad
Showing the full text of one real published post (with permission) would be stronger proof than titles in a capture.
