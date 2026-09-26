# Design — Chalk & Saffron

Written from the built product, not decided in advance. It describes what
shipped on the `redesign/loop` branch (26 Sep 2026) and what a later change
should stay consistent with.

Scope: **one system for everything a visitor or user sees** — the marketing
site (`/`, `/pricing`, `/docs/site-api`), sign-in and sign-up, and the
signed-in app. The admin console still runs its own gray/indigo look and is not
covered here. The previous marketing system (paper, carbon, brick, Bodoni
italic) and the previous app system (ink, signal green) are both retired; their
tokens no longer exist.

## The idea: the Loop

Contivo is a dependency chain: it cannot write until it knows the brand and the
market. The whole product is organised as that chain, six stages walked in
order — **Know → Watch → Think → Make → Ship → Learn**.

- In the app, the workspace is the loop (`lib/workspace-loop.ts` maps the old
  tabs onto stages; `LoopRail` draws it). Stage state is read from
  `workspace-journey.ts`, never invented.
- The home screen ("Today") is the loop plus three moves for the week.
- The marketing site is the loop walked as a page, chapter by chapter, and
  stage 03 — the refusal — owns a full-bleed dark field.

## Color

| Token | Value | Role |
|---|---|---|
| `chalk` | `#EEEDE6` | Ground, everywhere. |
| `chalk-raised` | `#F8F7F2` | Cards, inputs, image mats. |
| `chalk-sunk` | `#E2E1D8` | Tracks, chips, empty day cells. |
| `moss` | `#17201B` | All primary text; dark buttons; active nav. |
| `moss-700` | `#2F4A3A` | Hover on dark buttons; "done"/"published". |
| `moss-muted` | `#4A544D` | Secondary text. |
| `forest` | `#1E2E25` | The refusal field; "What moved"; Founder plan. |
| `forest-muted` / `forest-line` | `#B9C2B6` / `#3A4C41` | Secondary text and rules on forest. |
| `saffron` | `#E3A21A` | **You** on a chart, **act** on a button, **now** on the loop. Nothing else. |
| `saffron-soft` / `saffron-ink` | `#F4DFA8` / `#6B5410` | Saffron hover; saffron-family text on chalk. |
| `rival` | `#3D5F8A` | Every competitor, on every chart. |
| `rule` / `rule-strong` | `#D5D4CA` / `#A9A89C` | Hairlines; dashed "ahead" states. |

Red, amber and green stay only as status colours (error, warning, success).

Measured contrast (WCAG):

| Pair | Ratio |
|---|---|
| moss on chalk | 14.21 |
| moss-muted on chalk / chalk-raised / chalk-sunk | 6.71 / 7.34 / 6.00 |
| moss on saffron (every saffron button) | 7.51 |
| saffron-ink on chalk | 6.17 |
| chalk on forest / forest-muted on forest | 12.15 / 7.78 |
| saffron on forest / on moss | 6.42 / 7.51 |
| rival on chalk | 5.59 |
| **saffron on chalk** | **1.89 — never use saffron as text or a focus ring on chalk** |

Charts: you are saffron with a moss outline; rivals are rival blue and their
kinds differ by **fill**, not hue — direct solid, indirect hollow, aspirational
moss — so the chart survives greyscale and colour blindness.

## Type

- **Display — Bricolage Grotesque** (`font-display`): headlines, the wordmark.
- **UI and body — IBM Plex Sans** (`font-plex`).
- **Numbers, stage labels, meta — IBM Plex Mono** (`font-plexmono`).
- **Persian — Vazirmatn** for everything; Plex has no Persian glyphs and falls
  through to it per character.
- Emphasis is a **saffron marker stroke** under the words (sweeps in on load),
  never italics — italics break Persian letter joins.
- The wordmark is `contivo`, lowercase, beside a saffron diamond.

## Rules

- **Real product, real numbers.** Every product image is a capture of the
  running app with a provenance sidecar. No customers, testimonials or outcome
  claims exist, and the site says so. Examples (the run log) are labelled.
- **One level of card.** Tabs no longer sit in a bordered box; do not nest
  cards inside cards.
- **No gradients** as surface or text. The purple-blue brand gradient is gone.
- **Touch targets ≥ 44px**; phones get a bottom tab bar in the app.
- **RTL through logical properties** (`ms-`, `pe-`, `start-`). The loop plot is
  the one deliberate LTR island: it runs clockwise in both languages. Persian
  weeks start on Saturday; digits are Persian.

## Motion

Every movement demonstrates behaviour; none decorates. All of it is
`motion-safe:` and every timer checks `prefers-reduced-motion`, so the page
stills into a complete picture.

| Where | What it shows |
|---|---|
| Hero loop | The arc draws itself, stages pop in, Think ripples; stages auto-cycle until picked. |
| Intake | Four real steps of a read tick through; invalid input shakes with the real error. |
| The refusal | "Make it write a post now" — each press shakes the lock and escalates the refusal. |
| Cadence | 1–14 posts a week redistribute across the reader's week. |
| Run log | Example lines type in, including a judge veto; Replay. |
| Chapters | Rise into view once, on scroll. Content is visible without JS. |

## Browser surfaces

`.theme-chalk` (on the app shell and every marketing page) themes selection
(saffron behind moss), caret (moss-700), focus ring (2px moss, 3px offset) and
the scrollbar, and scopes the shadcn variables (`--primary`, `--muted`,
`--ring`…) to this palette.

## Assets

`public/marketing/`: `brand-memory.webp`, `market-map.webp`,
`setup-chain.webp`, `generated-post.webp` (Puppeteer, 1440×900 at DPR 2, from an
example workspace built from `posthog.com`), `contivo-reel.mp4` (12 s, no audio)
and `reel-poster.webp`.

## Known gap

**The captures and the reel predate this redesign** — they show the app's old
look. They are honest, so they stay until re-shot. Re-shoot them with
`pnpm --filter @contivo/web capture:marketing <workspaceId>` against a populated
workspace: it opens Chrome, waits for you to sign in yourself, then writes all
six files and their provenance sidecars at the sizes the page already expects.
