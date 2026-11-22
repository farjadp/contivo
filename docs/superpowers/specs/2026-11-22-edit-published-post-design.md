# Edit a published post — design

Date: 2026-11-22 · Owner: contivo-cto · Branch: `feat/edit-published-post`
Follows `2026-11-21-write-own-post-design.md` (debt item: published items had no Edit button).

## Problem
A published blog post can't be corrected from the app: the pipeline card shows no Edit button
once the status is PUBLISHED. A typo in a live article needs a database edit.

## Options
| | Option | For | Against |
|---|---|---|---|
| A | **Edit in place**: title and body editable on PUBLISHED blog items, slug stays frozen, status and publish date unchanged; ping the site's revalidate URL | The Content API already serves the row live, so a save is the whole publish; URL stays stable; small | No edit history (the old text is gone) |
| B | Unpublish → edit → republish | Reuses the schedule path | Post disappears meanwhile; `publishedAt` moves, which breaks "Updated" and feed order |
| C | Draft revisions of a published post, approved separately | History and review | New model and UI; far too big for a typo fix |

**Pick: A.** History is deferred debt.

## Design (A)
- Server action `updatePublishedPost({ contentId, title, content })` in `actions/own-post.ts`:
  owner check; only `status PUBLISHED` and `channel blog` (else `not_editable`); same title/body
  validation; updates `topic` and `content` only (status, slug, `publishedAtUtc` untouched;
  `updatedAt` moves, so the blog shows "Updated"); then pings the workspace's active site
  revalidate URL with `event: 'post.updated'` via a helper exported from `site-api/publisher.ts`.
  A failed ping never fails the save (the API already serves the new text; the site cache
  expires within 600 s). Activity log `CONTENT_EDITED_AFTER_PUBLISH`.
- LinkedIn: no Edit after publish — the post on LinkedIn can't be changed from here, and an
  in-app edit would silently diverge from what is live.
- UI: PUBLISHED blog cards get "Edit". The editor opens with title and body, the slug read-only,
  no schedule panel, and a note that saving updates the live article. Strings en, fa, it.

## Done when
Unit tests for the action (status/channel guards, no status/slug change, revalidate called,
ping failure tolerated); typecheck; locally: edit a published post, the blog page shows the new
title/body, URL unchanged, in en and fa.
