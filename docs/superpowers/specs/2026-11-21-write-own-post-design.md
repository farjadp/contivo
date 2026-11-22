# Write your own post — design

Date: 2026-11-21 · Owner: contivo-cto · Branch: `feat/write-own-post`
Source: `.claude/agent-org/work/growth/content/2026-11-21-blog-publish-blockers.md`

## Problem

No UI path creates a content item from text you wrote. Instant Content makes items with no
workspace (so the Content API never serves them) and an AI body; ideation/autopilot write an AI
body and are locked until competitors are accepted. The pipeline editor can change the body but
not the title, which the blog uses as H1 and slug source. Persian titles slugify to
`post-xxxxxxxx`. This blocks our own W46 articles and any pilot customer with their own text.

## Options

| | Option | For | Against |
|---|---|---|---|
| A | **"Write a post" panel inside the workspace Pipeline tab**, new server action creates a READY item; title + slug editable in the existing editor | Reuses schedule → `publish-due` → Content API unchanged; Pipeline is never gated; no schema change | PipelineTab is already 880 lines (new panel goes in its own file) |
| B | Extend Instant Content with a "use my own text" mode and a workspace picker | One "create" place | Instant is a different page and flow (AI first); workspace picker adds a second ownership path; still needs title editing in Pipeline |
| C | Import markdown file (front-matter title/slug) into the pipeline | Fast for agents | Worse for customers typing in the app; parsing edge cases; still needs editing |

**Pick: A.** Smallest change that reuses the publish path end to end and works while
Ideation/Calendar are locked.

## Design (A)

### Server (`apps/web/src/app/actions/own-post.ts`, new)
- `createOwnPost({ workspaceId, title, content, channel, slug? })` — `channel` is `blog` or
  `linkedin`. Verifies the workspace belongs to the session user. Creates `ContentItem` with
  `type` ARTICLE (blog) / POST (linkedin), `status` READY, `creditsCost` 0, no AI call.
  Returns `{ ok: true, item } | { ok: false, error: code }`.
- `updateOwnPostMeta({ contentId, title, slug? })` — owner-checked. Title editable anytime.
  Slug editable only while the item has never been published (`publishedAtUtc` null and
  status not PUBLISHED/PUBLISHING); after that a different slug is rejected (`slug_frozen`).
  Empty slug = clear it (auto at publish).
- Validation (`apps/web/src/lib/content-slug.ts`, pure): title 1–200 chars trimmed;
  body 1–100 000 chars; slug `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 80 chars; unique in the workspace
  (checked in the action, backed by the existing `@@unique([workspaceId, slug])`).
  Error codes: `title_required`, `title_too_long`, `body_required`, `body_too_long`,
  `slug_invalid`, `slug_taken`, `slug_frozen`, `not_found`.
- Slug only applies to `blog` items; LinkedIn ignores it.

### Publisher (`lib/site-api/publisher.ts`)
- A pre-set `slug` is used as is; otherwise `buildUniqueSlug(topic)` as today. The slug is
  written at publish and never changed (existing rule).

### UI
- Pipeline tab: a "Write a post" button above the list (and in the empty state next to the
  ideation link). Opens a panel (`WritePostPanel.tsx`): channel (Blog / LinkedIn), title,
  slug (blog only, optional, with live format hint), markdown body (textarea). Save → item
  appears READY in the list; schedule as any other item.
- Editor modal: title field and (blog, unpublished) slug field above the body; published items
  show the slug read-only. Saving calls `updateOwnPostMeta` then `updateContentAndSchedule`.
- All strings in `messages/{en,fa}/tabs-a.json`, Persian written natively.

## Bug fixes in the same branch (separate commits)
1. **Unknown blog slug → 500.** Reproduced on prod (`/en/blog/does-not-exist` → 500). Cause to
   prove locally: root layout renders no `<html>`; `notFound()` under `[locale]` has no
   `not-found.tsx` to render inside the locale layout. Fix: `[locale]/not-found.tsx`.
2. **`updateContentAndSchedule` time zone.** Uses `new Date(new Date(local).toLocaleString(..))`,
   which `lib/autopilot/schedule.ts` itself documents as double-applying the offset. Test first,
   then use `parseLocalDateTimeToUtc` like `scheduleContentItem`.
3. **Markdown tables** in `lib/blog/content.ts` + `article-body.tsx`, only if small.

## Out of scope
Schema changes; image upload for own posts; the client-side date/zone mismatch in the
schedule modal (browser-local defaults vs chosen zone) — noted as debt.

## Done when
Tests green (unit for validation, actions, publisher slug, TZ), typecheck green, a post written
in the browser in en and fa appears READY, can be edited (title/slug), scheduled, published by
`publish-due` locally, and served at `/{locale}/blog/<slug>`; unknown slug returns 404.
