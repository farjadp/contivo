# Design

Written at finish, from the built marketing surface — not as a rulebook decided
in advance. It describes what shipped on 1 Sep 2026 and what a later change
should stay consistent with.

Scope note: this documents the **marketing surface** (`/`, and the nav and footer
it shares). The signed-in app still runs the older "control room" system — dark
ink surfaces, signal green, mono labels — and the two are deliberately not yet
reconciled. Bringing the app across is Mission #42 in Contivo Mission Control.

## The world

Warm printed paper and carbon ink, with one brick red that is allowed to own a
whole viewport. It is an editorial system: hairline rules, square corners,
generous whitespace, and type doing the structural work that cards usually do.

It was chosen because it already existed — the onboarding and workspace-creation
screens were built in it — and because the surface it replaced (near-black,
neon-green accent, simulated terminal) was rejected by the user as generic AI
design. The replacement earns the palette by committing it at page scale rather
than rendering its softest version.

## Color

| Token | Value | Role |
|---|---|---|
| `paper-warm` | `#EFECE5` | The page ground. Body background. |
| `paper-light` | `#FDFCF8` | Alternating section ground, and image mats. |
| `carbon` | `#121212` | All primary text. The closing section's ground. |
| `carbon-80` | `#3A3A38` | Body copy on paper. |
| `carbon-60` | `#6B6B66` | Secondary text, captions, the italic accent word. |
| `carbon-40` | `#9C9C95` | Placeholders and the `https://` prefix. |
| `carbon-20` | `#D6D3CA` | Scrollbar thumb. |
| `brick` | `#C04C36` | The refusal act's full-bleed field; hover state on every dark button; focus ring; selection. |
| `brick-deep` | `#A63D29` | Error text on paper. |
| `brick-ink` | `#FFF8F4` | All text on the brick field. |

Strategy: **Committed** — the brick is not an accent, it carries an entire
viewport as a printed ink field. Rules on paper are `carbon/10`–`carbon/15`;
rules on brick are `brick-ink/25`.

**`brick-ink` is `#FFF8F4`, not `#FDF2EE`.** The warmer value measured 4.42:1
against `#C04C36` — under the 4.5 floor. Do not warm it back up, and do not
introduce opacity steps on text over the brick field: every step costs contrast
that field cannot spare. Secondary text there is differentiated by size and
weight only. Measured after the build: body, list items and captions all read
4.62:1 on a ground sampling exactly `rgb(192, 76, 54)`.

## Type

- **Display — Bricolage Grotesque** (`font-display`, variable `opsz`). Headlines,
  the intake field, evidence numbers, button labels, footer column heads.
  Chosen for character at poster scale; a UI sans enlarged is not a display voice.
- **Accent — Bodoni Moda italic** (`font-accent`). Exactly one word per headline,
  in `carbon-60`. This gesture is inherited from the onboarding screens; before
  this work those used the browser's default serif, which is not a choice.
- **Body — Inter** (`font-sans`).
- Tracking runs `-0.045em` at display sizes up to `-0.02em` at small ones.
  Display never exceeds `7.5rem`. Body measure stays inside 65–75ch.
- `.tnum` (tabular numerals) on any figure a reader might compare.

Faces deliberately avoided: the AI-default editorial serifs (Fraunces, Playfair,
Cormorant, Newsreader and company), and Inter-as-display.

## Composition

Three acts, in this order, and the order is the argument:

1. **Intake** — cream, full bleed. A display sentence, then the product's only
   input at `clamp(1.5rem, 2.9vw, 2.5rem)` on a 2px rule that turns brick on
   focus, then real cost and token counters from a live workspace.
2. **Refusal** — the brick field, full bleed, "It will not write *yet*." at up to
   7rem, over a real screenshot of the locked setup chain.
3. **Output** — paper again, with a real generated post at full legibility.

Between and after: the reel, the intelligence spread, channels, and a carbon
close. Sections alternate `paper-warm` and `paper-light`, separated by
`border-carbon/10`, so the brick and carbon fields land as events.

## Rules the surface holds to

- **No cards.** Structure comes from rules, spacing and type scale. No nested
  containers, no same-size icon-heading-text grids.
- **No eyebrows or kickers**, no `01 / 02 / 03` section numbers, no uppercase
  mono micro-labels. The onboarding screens still use these; do not copy them
  forward.
- **No gradients anywhere**, in text or as surface.
- **Square corners.** No `border-radius` on the marketing surface.
- **Every product image is a real capture** of the running app, at 2×, with its
  provenance in a `.webp.json` sidecar. Generated imagery is confined to
  material — the ink and paper textures — and never depicts the product, a
  person, or a claim.
- **No invented proof.** No customers, testimonials, logos, metrics or outcome
  claims exist, and the page says so twice rather than implying otherwise.

## Motion

One authored moment, not scattered effects: the intake rule turning brick on
focus, and the arrow on each button translating on hover. Both are
`duration-300`. The reel is the only autoplaying motion, and it pauses itself
under `prefers-reduced-motion` and always carries a visible play/pause control.

## Browser surfaces

Themed on `.theme-editorial` rather than left to the browser: selection
(brick on `brick-ink`), caret, focus ring (2px brick, 3px offset), and the
scrollbar. This is the cheapest signal that a page was built rather than
assembled.

## Assets

Everything ships from `public/marketing/`, about 1.1 MB total.

- `brand-memory.webp`, `market-map.webp`, `setup-chain.webp`,
  `generated-post.webp` — Puppeteer captures at 1440×900 / DPR 2 from an example
  workspace built from `posthog.com`.
- `contivo-reel.mp4` — 12 s, 1280×800, H.264, **no audio track**, built with
  ffmpeg from four of those captures. `reel-poster.webp` is its first frame.
- `tex-ink.webp`, `tex-paper.webp` — gpt-image-1. The ink texture is
  multiply-blended over the `brick` token so the net on-screen value stays
  `#C04C36`; verify by sampling, not by eye, after any change.

## Known gap

The reel and the generated-post capture both show inner app UI that has not been
redesigned yet — a purple "Rescrape Website" button in one, and a purple-to-cyan
gradient card border in the other, which was cropped off. They are honest
captures, so they stay; they will stop clashing when the app moves onto this
system.
