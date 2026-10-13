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
| Video pipeline | `feat/video-pipeline` | cloud Claude session | `docs/video-pipeline/**`, `apps/render-worker/**` (new), and — in later phases, announced here first — `apps/api/prisma/schema.prisma` (VIDEO additions only), `apps/api/src/modules/jobs/jobs.constants.ts` (new `RENDER` queue only) | Planning — see `docs/video-pipeline/PLAN.md` |

Schema changes from any stream: write a migration file **and** note it here,
because two streams changing `schema.prisma` will conflict.
