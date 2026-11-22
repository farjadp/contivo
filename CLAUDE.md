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
| Write your own post | `feat/write-own-post` | local session (contivo-cto) | `apps/web/src/app/actions/own-post.ts`, `lib/content-slug.ts`, `growth/[id]/_components/{PipelineTab,WritePostPanel}.tsx`, `[locale]/not-found.tsx`; edits to `actions/calendar.ts`, `lib/site-api/publisher.ts`, `blog/[slug]/page.tsx`, `lib/blog/content.ts`, `components/blog/article-body.tsx`, `messages/*/{tabs-a,shell}.json`. No schema change. | Built, PR open — see `docs/superpowers/specs/2026-11-21-write-own-post-design.md` |
| Funnel + AI-cost tracking | `myca/funnel-tracking-736ecd` | local session (contivo-head-of-data) | `apps/web/src/lib/ai-usage.ts`, `apps/web/src/lib/last-seen.ts`, usage lines at the 12 OpenAI/Gemini fetch sites, `actions/auth.ts`, `apps/api/scripts/set-user-cohort.ts`. **Schema:** migration `20261121120000_funnel_tracking` (additive: `users.lastSeenAt`, `users.cohort`, `ai_usage_logs.provider/workspaceId`, `ai_usage_logs.userId` + `estimatedCostUsd` nullable) | PR open, awaiting release queue |
| Publishing channels (Telegram, X, WordPress, Threads) | `myca/channels-211611` (spec + core), one branch per channel later | local session (contivo-cto) | `docs/superpowers/specs/2026-11-21-publishing-channels-design.md`; later `apps/api/src/modules/social/**` (adapters, publish service/processor/scheduler, oauth, new telegram/wordpress/threads modules), `apps/api/src/common/net/**`, `apps/web/src/app/actions/social*.ts`, `connections/_components/**`. **Schema:** migration `20261122090000_publishing_channels` (additive: SocialPlatform += TELEGRAM, THREADS; ContentChannel += telegram, threads; `social_connections.metaJson`; WordPress deferred to its own PR) | Core PR #22 (publish core + migration); Telegram next |
| AI provider failover | `myca/ai-failover-aba0e1` | local session (contivo-head-of-data → contivo-cto) | `apps/web/src/lib/ai/**` (new), AI call sites (transport only): `lib/competitors/{search,queries,judge,pipeline,run-errors}.ts`, `lib/matrices/openai.ts`, `lib/report/narrative.ts`, `lib/gemini.ts`, `lib/content-engine.ts`, `lib/humanize.ts`, `lib/narrative/engine.ts`, `lib/autopilot/{quality-gate,runner}.ts`, `actions/growth-{brand-assets,keywords,offerings}.ts`, `actions/guide.ts`, `lib/admin-console.ts` + admin AI providers card, `lib/ai-usage.ts` (AiProvider type), AutopilotTab review toggle, `messages/*/growth.json` (aiUnavailable). **Schema:** migration `20261122120000_ai_provider_events` (additive: table `ai_provider_events`, `autopilot_policies.requireReview`) | Building — see `docs/superpowers/specs/2026-11-22-ai-provider-failover-design.md` |
| Social security hotfix (P1 + P2-A) | `fix/social-workspace-scope-oauth-csrf` | local side session (contivo-security-engineer) | `apps/api/src/modules/social/{social-publish.service,social-oauth.service,social-oauth.controller,social.module,oauth-store}.ts`, `apps/api/test/{social-workspace-scope,social-oauth-csrf,oauth-secrets}.test.ts`, `apps/web/src/app/actions/social-connect{,.test}.ts`, `connections/page.tsx`, `messages/*/connections.json` (`connectResult` only). No schema change. | Merged to main (PR #20, #23) |
| Credits visibility (PR B) | `fix/credits-visibility` | local session (contivo-backend-developer) | `apps/web/src/lib/{credit-costs,credit-requests}.ts`, `lib/autopilot/run-errors.ts`, `app/actions/credits.ts`, `growth/[id]/_components/{CreditNotice,WorkspaceCredits}.tsx`, `admin/_components/LowCreditsPanel.tsx`; edits to `lib/credits.ts`, `lib/activity-log.ts`, `lib/autopilot/runner.ts` (out-of-credits error writes only), `components/shared/credit-balance.tsx`, `AutopilotTab.tsx`, `growth/[id]/page.tsx` (3 lines), `admin/page.tsx`, `messages/*/{tabs-b,admin,errors}.json`. No schema change. | PR open |
| B8 quality gate on manual drafts | `myca/b8-manual-quality-gate` | local side session (contivo-backend-developer) | `apps/web/src/lib/quality-verdict{,-shared,-token}.ts` (new), `apps/web/src/app/actions/quality-gate.ts` (new), gate calls in `lib/content-engine.ts`, verdict write in `lib/autopilot/runner.ts`, enforcement in `actions/calendar.ts`, `growth/[id]/_components/{QualityVerdictNotice,PipelineTab,IdeationTab}.tsx`, `messages/{en,fa,it,es,he}/tabs-a.json` (`quality` only). **Schema:** migration `20261122180000_content_quality_verdict` (additive: `content_items.qualityVerdict` JSONB nullable) | PR open, awaiting release queue — see `docs/superpowers/specs/2026-11-22-manual-quality-gate-design.md` |
| Social sign-in (Google, then GitHub) | `myca/social-login-397702` | local session (contivo-cto) | `apps/web/src/lib/oauth/**`, `apps/web/src/app/api/auth/oauth/**`, `lib/signup-cohort.ts`, `components/marketing/{social-buttons,oauth-error-notice}.tsx`, sign-in/sign-up pages, `messages/*/{auth,legal}.json` (social + Privacy/Terms provider text only); small edit to `actions/auth.ts` (cohort import, `method` in log detail). **Schema:** migration `20261123090000_oauth_accounts` (additive: enum `OAuthProvider`, tables `oauth_accounts`, `oauth_tx_used`) | Google built, PR open; GitHub + Settings link/unlink next — see `docs/superpowers/specs/2026-11-22-social-login-design.md` |

Schema changes from any stream: write a migration file **and** note it here,
because two streams changing `schema.prisma` will conflict.
