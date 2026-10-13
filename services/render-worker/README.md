# Render worker

Renders short vertical videos from a JSON spec with [HyperFrames](https://github.com/heygen-com/hyperframes)
and sends them to Telegram for approval. **Phase 1: nothing is published.**

Lives outside the pnpm workspace on purpose (`services/`, not `apps/`), so it
never enters CI or the contivo-api build. Plan: `docs/video-pipeline/PLAN.md`.

## Flow

```
/render <spec>  (Telegram)  or  BullMQ job on "contivo-render"
  → images (OpenAI, IMAGE_MODEL)  → generated music (music/music.py)
  → HyperFrames project (src/compose.js) → lint gate → render MP4
  → Telegram video with ✅ / ✏️ / ❌
```

## Environment (Railway service variables)

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | `${{contivo-api.OPENAI_API_KEY}}` (reference — never paste the value) |
| `GEMINI_API_KEY` | `${{contivo-api.GEMINI_API_KEY}}` (not used yet; no image quota) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (optional; in-process queue without it) |
| `TELEGRAM_BOT_TOKEN` | set by Farjad in the Railway UI only |
| `TELEGRAM_ALLOWED_CHAT_ID` | set by Farjad after the bot replies with it |
| `IMAGE_MODEL` | optional, default `gpt-image-1` |

Until `TELEGRAM_ALLOWED_CHAT_ID` is set the bot only replies with the chat id
and does nothing else — every render costs API money, so it is default-deny.
**This repo is public: never commit tokens or chat ids.**

## Spec format

See `specs/eresidency-fa.json`. Scene types: `hook`, `body`, `list`, `warn`,
`cta`. `**word**` → accent colour, `\n` → line break. `image` is a prompt.
Limits: 8 scenes, 90 s (Instagram's API cap for Reels).

## Local

```bash
npm ci
HYPERFRAMES_BROWSER_PATH=/path/to/chromium node src/cli.js specs/eresidency-fa.json --no-images
```

## Rules learned the hard way

- Never `dir="rtl"` on `<html>` → black video, no error. `compose.js` puts
  direction on `#root`; the lint gate blocks it anyway.
- GSAP + Vazirmatn are bundled; no CDN at render time.
