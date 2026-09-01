# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Founders and solo operators of small B2B companies who have to market themselves and
have no marketing team. They are technical or semi-technical, time-poor, and already
running the business — marketing is the thing that slips. Secondary: small agencies
running this for several clients at once (the workspace model supports it; no agency
pricing or seat model is decided).

The one confirmed real user is the product's own founder, running it on his own
company site.

## Product Purpose

Contivo turns one company URL into a marketing system that runs without a person in
the loop. It scrapes the site into an editable brand memory, discovers and verifies
competitors, builds positioning matrices and keyword intelligence from them, then
ideates, drafts, humanises, illustrates, quality-checks and publishes content to
LinkedIn, X, Instagram, Facebook, TikTok and the customer's own website on a schedule
the customer sets.

Success is the shortening of "URL → first published post", and then the customer never
having to think about it again.

## Positioning

The mechanism a neighbouring product cannot truthfully copy: **Contivo refuses to
write until it has intelligence.** Ideation is gated on Market Matrices and Competitor
Keywords existing — a deliberate guardrail, not a bug. Most AI writing tools start from
a blank prompt and therefore produce blank-prompt content; Contivo's drafts are
derived from a brand memory and a verified competitive map.

The second uncopyable part is the **fail-closed quality gate**. Every autonomous draft
passes deterministic checks (platform limits, leaked scaffolding, the customer's
never-write-about list, near-duplicates of prior posts) and an AI judge scoring brand
fit, factual safety and clarity. If no AI provider answers, the post is held, never
published unreviewed. Factual safety is the strictest threshold: invented statistics,
named studies and first-person client anecdotes are vetoed.

## Operating Context

Evaluated in a browser, on a laptop, in a working day, usually in a spare twenty
minutes between other work. The decisive moment is the first five: paste a URL, watch
the site get read, see a competitive map appear that the visitor recognises as true
about their own market. Nobody evaluates this at leisure and nobody reads a long page.

After setup the product is mostly unattended — the customer's contact with it is a
weekly glance at a queue and a run log, not daily use.

## Capabilities and Constraints

Confirmed and working:

- Brand memory extracted from a URL; editable tone, audience, value proposition, offers
- AI competitor discovery, with manual accept/reject and hand-added competitors enriched
  from live site evidence
- Five market matrices, each scoring every company 1–10 on two axes
- Competitor keyword intelligence: clusters, intent split, gaps; SEO data via DataForSEO
- Products & services comparison, customer vs competitors
- Framework-driven ideation, content pipeline, calendar, per-platform word counts
- Autopilot: per-workspace policies ("agents") with cadence, channels, publish window,
  timezone and steering; a cron runner that ideates → drafts → schedules unattended
- Quality gate as described in Positioning
- Publishing: OAuth to the social platforms; own website via an API key the customer's
  site reads from `GET /api/v1/posts`, so nothing is pushed into their codebase
- AI-designed strategic reports as HTML + PDF
- Credit ledger, AI usage log, per-workspace activity log, admin console

Constraints and undecided facts:

- **Billing does not exist.** `BillingModule` is an empty TODO. Nothing charges. Plans
  and prices are not decided; the pricing page must not be treated as confirmed truth.
- Strategic Reports do not work on serverless (Puppeteer + writing to `public/`)
- Social tokens are stored with XOR obfuscation, not real encryption
- Zero automated tests
- Gemini with an OpenAI fallback; both can be unavailable, and the product is designed
  to hold rather than degrade when they are

Terminology, used consistently in the product and its copy: **workspace**, **brand
memory**, **market matrix**, **competitor keywords**, **pipeline**, **agent**,
**Autopilot**, **quality gate**, **run log**.

## Brand Commitments

- Name: **Contivo**. Live at www.contivo.app.
- The company that makes it is North Road / AshaVid (Farjad P.D, Newmarket, Ontario).
- An editorial identity already exists in the product's onboarding and workspace-creation
  screens and is **binding for this work**: warm paper ground `#EFECE5` / `#FDFCF8`,
  near-black `#121212`, one Bauhaus red `#C04C36`, large editorial display type with an
  italic accent word, square corners, generous whitespace.
- Voice: plain, specific, unhyped. States mechanisms rather than benefits. Says what the
  product refuses to do as readily as what it does.
- Explicitly rejected by the user: the previous dark-ground / neon-green / simulated-
  terminal landing page. It read as generic AI-product design.

## Evidence on Hand

Real, usable:

- A **genuinely published, fully unattended post** on LinkedIn from 18 Aug 2026 —
  written, humanised, illustrated, quality-gated and published with nobody watching:
  `urn:li:share:7495350777063075840`
- The **running product**, from which real screenshots and screen recordings can be
  captured: workspace hub, brand memory, market matrices, competitor map, pipeline,
  calendar, Autopilot tab and its run log
- A real Autopilot run log with step-by-step entries
- Image generation available in-repo (`gpt-image-1`, `lib/content-image.ts`) for
  textures and atmosphere

Absences that must never be fabricated:

- **No customers, no testimonials, no logos, no case studies, no usage metrics, no
  funding, no team photos.** The product has one real user, its founder.
- **No confirmed pricing.** Any price shown is a placeholder on the user's replacement
  list.
- No press, no awards, no third-party validation of any kind.

Any demonstration data used in the interface must be authored at full fidelity and
labelled as an example.

## Product Principles

1. **Intelligence before content.** The product's value is what it knows before it
   writes. Anything that presents Contivo as a writing tool undersells it and invites
   the comparison it loses.
2. **Refusal is the feature.** Fail-closed behaviour, the ideation guardrail and the
   factual-safety veto are what make unattended publishing safe to sell. Say them out
   loud.
3. **Show the mechanism, never simulate it.** The product is real and running; proof is
   captured from it. Fabricated chrome standing in for the product is the failure mode
   this project has already shipped once.
4. **Claim nothing that is not true yet.** With no customers and no billing, credibility
   has to come from demonstrated mechanism, not from social proof.
5. **The founder is the proof.** The only real deployment is the founder's own company.
   That is a strength to use honestly, not a gap to paper over.

## Accessibility & Inclusion

No product-specific standard has been set. Baseline expectation: WCAG AA contrast,
full keyboard operability, visible focus, and motion that respects
`prefers-reduced-motion` — the marketing surface leans on imagery and video, so
reduced-motion and no-video fallbacks are required rather than optional.
