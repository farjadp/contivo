# Contivo — instructions for Claude

Read these before changing anything:

1. `HANDOFF.md` — current state, deploy quirks, open work.
2. `memory.md` — durable architecture context and development rules.

This repo is **public**. Never commit secrets, tokens, API keys, chat IDs or
`.env*` contents.

## Parallel work — more than one Claude works on this repo

Farjad runs local Claude Code sessions **and** a cloud Claude session (claude.ai)
on this repository at the same time. To avoid overwriting each other:

- **Before starting any task:** `git fetch origin`, then check open PRs
  (`gh pr list`) and the table below.
- **Never edit files owned by another active stream** without asking Farjad.
  If you must touch one, say so in your summary.
- **Never work directly on `main`** for a multi-file change. Use a branch + PR.
- **When you start or finish a stream,** update the table below in the same PR.

| Stream | Branch | Owner | Files it owns | Status |
|---|---|---|---|---|
| Video pipeline | `feat/video-pipeline` | cloud Claude session | `docs/video-pipeline/**`, `services/render-worker/**` (new, outside the pnpm workspace), and — in later phases, announced here first — `apps/api/prisma/schema.prisma` (VIDEO additions only), `apps/api/src/modules/jobs/jobs.constants.ts` (new `RENDER` queue only) | Phase 1 built: render worker — see `docs/video-pipeline/PLAN.md` |
| contivo.app blog | `feat/contivo-blog` | local side session | `apps/web/src/lib/blog/**`, `apps/web/src/components/blog/**`, `apps/web/src/app/[locale]/(marketing)/blog/**`, `apps/web/src/app/api/blog/**`, `apps/web/messages/*/blog.json`; one-line additions to `routing.ts`, `request.ts`, `global-header.tsx`, `site-footer.tsx`, `sitemap.ts`, `i18n/navigation.ts`. No schema change. | Built, awaiting release queue — see `docs/superpowers/specs/2026-11-11-contivo-blog-design.md` |
| Funnel + AI-cost tracking | `myca/funnel-tracking-736ecd` | local session (contivo-head-of-data) | `apps/web/src/lib/ai-usage.ts`, `apps/web/src/lib/last-seen.ts`, usage lines at the 12 OpenAI/Gemini fetch sites, `actions/auth.ts`, `apps/api/scripts/set-user-cohort.ts`. **Schema:** migration `20261121120000_funnel_tracking` (additive: `users.lastSeenAt`, `users.cohort`, `ai_usage_logs.provider/workspaceId`, `ai_usage_logs.userId` + `estimatedCostUsd` nullable) | PR open, awaiting release queue |

Schema changes from any stream: write a migration file **and** note it here,
because two streams changing `schema.prisma` will conflict.
