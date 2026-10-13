# Video pipeline — plan

Status: **planning** · Branch: `feat/video-pipeline` · Owner: cloud Claude session (see `CLAUDE.md` → "Parallel work")

Contivo's first customers are Farjad's own brands. They are **internal design
partners**, not market validation — do not count them as traction in pitches.
The video pipeline is built for them first, but every core feature must pass:
*"would an external customer pay for this?"* Brand-specific needs (Persian RTL,
immigration fact-checks) live in workspace settings, not the core.

## Workspaces (one per brand)

| Workspace | Language | Channels |
|---|---|---|
| Startup Visaroad | Persian | Instagram `startup_visaroad`, TikTok `ashavidgroup` (decision pending), YouTube (personal) |
| Visaroads | English | Instagram `visaroads`, TikTok `ashavidgroup`, YouTube `ashavidgroup`, LinkedIn `visaroads` |
| Ashavid | English | LinkedIn `ashavid` (role pending) |
| UpsideTree (درخت وارونه) | TBD | TBD |

## What exists today (audit, 13 Oct 2026)

- `ContentType` has no `VIDEO`; `ContentChannel` has no `tiktok` / `youtube`.
- `ContentImage` stores bytes in Postgres. Correct for images, **wrong for
  video** (multi-MB) → video needs object storage (Railway bucket or S3).
- `InstagramAdapter` is a Phase 2 stub (rejects all publishes).
- `TikTokAdapter` supports photo carousels only. No YouTube adapter.
- BullMQ worker pattern exists: `social/publish.processor.ts`,
  `workspaces/crawl.processor.ts`. Queues in `jobs/jobs.constants.ts`.
- Image generation: `apps/web/src/lib/content-image.ts` (`gpt-image-1`).

## Architecture

```
Workspace (Brand Memory, Evidence)
  → content-engine: idea → script → fact-check against official source
  → ContentItem(type=VIDEO, status=GENERATED)
  → queue contivo-render  ──►  render-worker (new Railway service)
        assets: gpt-image / Gemini image, optional Veo hook clip, music
        HyperFrames compose + render (Chrome headless shell + FFmpeg)
        upload MP4 → object storage → ContentVideo row
  → Telegram approval (✅ approve / ✏️ edit / ❌ reject)
  → publish: Blotato API (phase 1) → native adapters later
```

### Why a separate render worker
Rendering needs Chrome + FFmpeg + CPU. It must not run inside `contivo-api`
(would block the publish scheduler) or on Vercel (read-only, time limits).

### Keys
The worker reads `OPENAI_API_KEY` / `GEMINI_API_KEY` via Railway reference
variables (`${{contivo-api.OPENAI_API_KEY}}`). Values never enter code, git or
chat. **This repo is public — never commit secrets, tokens or chat IDs.**

## Hard-won rules (from local tests, 13 Oct 2026)

1. **Never put `dir="rtl"` on `<html>`** — HyperFrames renders a fully black
   video with no error. Put `direction: rtl` on the root container instead.
2. Bundle GSAP and fonts (Vazirmatn) inside the composition — no CDN.
3. Music: generated or licensed only. No copyrighted tracks.
4. Every claim about an immigration programme must cite an official source
   with a check date, shown in the Telegram approval message and on screen.
   Example: Canada's Start-Up Visa stopped taking new applications on 1 Jan 2026.
5. Render speed (2 cores, software GL, screenshot mode): ~2.8 s per second of
   video. `chrome-headless-shell` enables the faster BeginFrame path.

## Phases

1. **Render worker MVP** — new service, `contivo-render` queue, renders a
   composition from a JSON spec, uploads MP4, sends to Telegram. No publishing.
2. **Data model** — `ContentType.VIDEO`, `ContentVideo` (storage key, duration,
   spec JSON), channels `tiktok` / `youtube`. Migration file + `db push`.
3. **Content engine integration** — script + fact-check step, Telegram approval
   writes back status.
4. **Publishing** — Blotato adapter behind the existing adapter interface.

## Metrics (first 30 days)

- Time from new workspace to first publishable video
- % approved without edits
- Edit rounds per item
- API cost per published item
- External goal: 3 paying customers by a set date
