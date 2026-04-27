# Contivo AI Memory

Generated: 2026-04-26

Use this file as durable context before asking an AI to modify or explain this repository. The project changes quickly, so prefer this file plus current source code over assumptions from older chats.

## High-Level Product

Contivo is an AI-powered marketing workspace. The main product experience is the Growth Engine, where a user creates a workspace from a company website and then builds:

- Brand Memory and editable brand knowledge.
- Competitive intelligence: competitor discovery, manual competitor validation, market matrices, competitor keywords, SEO signals, products/services comparison.
- Content ideation with framework selection.
- Content pipeline with draft generation, manual source inputs, word-count targeting, scheduling, and publishing workflow.
- Social account connections and publish jobs for LinkedIn, X, Facebook, Instagram, and TikTok.
- Admin controls for AI model choice, limits, word-count ranges, workspace/user controls, and diagnostics.

## Repository Shape

This is a pnpm/turbo monorepo.

```text
Contivo/
├── apps/
│   ├── web/   # Next.js 15, React 18, App Router, Tailwind, Prisma-backed server actions
│   └── api/   # NestJS 10 API, Prisma, BullMQ/Redis, social publishing endpoints
├── packages/
│   ├── types/   # shared TypeScript/Zod domain types
│   └── config/  # shared config
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── apps/api/prisma/schema.prisma
```

Important: a large part of the business logic currently lives in `apps/web/src/app/actions/*` as Next server actions. Do not assume every backend behavior is implemented in the Nest API.

## Runtime Stack

- Frontend: Next.js `15.5.12`, React `18.3.1`, Tailwind.
- API: NestJS 10.
- Database: PostgreSQL through Prisma.
- Queue: BullMQ + Redis through `apps/api/src/modules/jobs`.
- AI: Gemini primary in parts of the app, OpenAI fallback/alternate in several flows.
- Auth: Clerk, with app routes under `apps/web/src/app/(auth)`.
- Package manager: `pnpm@9.0.0`.

## Local Development

Start local services first:

```bash
docker compose up -d
```

`docker-compose.yml` is expected to start:

- PostgreSQL at `localhost:5432`, DB `contivo_dev`, user `postgres`, password `password`.
- Redis at `localhost:6379`.

Prepare Prisma from `apps/api`:

```bash
cd apps/api
pnpm prisma:generate
pnpm prisma:migrate
pnpm db:seed
```

Run the monorepo:

```bash
cd /Users/farjad/Downloads/Work-Studio/Contivo
pnpm dev
```

Expected URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`

Common startup failure:

- `PrismaClientInitializationError P1001 Can't reach database server at localhost:5432` means PostgreSQL is not running or Docker Desktop is not running.
- Redis is also required by BullMQ. The compose file includes Redis, but the local machine may also have Redis running independently.
- If Next server actions appear stale after code changes, stop/start `pnpm dev`; if needed remove `apps/web/.next`.

## Environment Variables

Use `.env.example` as the safe template. Do not copy secrets from `.env.local` into chats, commits, or docs.

Important env keys:

- `DATABASE_URL`
- `REDIS_URL`
- `API_PORT`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_URL`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_DEFAULT_MODEL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `COMPETITIVE_LANDSCAPE_LIMIT`
- `BRAND_MEMORY_RESCRAPE_LIMIT`
- Stripe and analytics keys as needed.

Admin-configurable settings are stored in `app_settings` and accessed through `apps/web/src/lib/app-settings.ts`. Environment variables override several settings.

## Main Web App Areas

Key app routes:

- `apps/web/src/app/(dashboard)/growth/page.tsx`: Growth Engine list/entry.
- `apps/web/src/app/(dashboard)/growth/new/page.tsx`: create workspace.
- `apps/web/src/app/(dashboard)/growth/[id]/page.tsx`: workspace dashboard tabs.
- `apps/web/src/app/(dashboard)/connections/page.tsx`: social connections.
- `apps/web/src/app/(admin)/admin/page.tsx`: admin console.
- `apps/web/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- `apps/web/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`

Workspace dashboard tabs are resolved in `growth/[id]/page.tsx`. Allowed tab keys:

- `pipeline`
- `ideation`
- `strategy`
- `progress`
- `matrices`
- `keywords`
- `offerings`
- `calendar`
- `seo`

Important components:

- `BrandMemoryTab.tsx`
- `CompetitiveMatricesTab.tsx`
- `CompetitorMapManager.tsx`
- `CompetitorKeywordsTab.tsx`
- `ProductsServicesTab.tsx`
- `IdeationTab.tsx`
- `PipelineTab.tsx`
- `CalendarTab.tsx`
- `SeoIntelligenceTab.tsx`
- `ProgressReportTab.tsx`

## Important Server Actions

Most Growth Engine workflows are in `apps/web/src/app/actions`.

- `growth.ts`: create workspace, scrape/analyze site, seed brand summary and initial competitors.
- `growth-competitors.ts`: discover competitors, save manual edits, enrich manually entered competitors, archive discovery runs.
- `growth-matrices.ts`: generate and save competitive matrices.
- `growth-keywords.ts`: competitor keyword intelligence and strategy signals.
- `growth-offerings.ts`: products/services intelligence for client and competitors.
- `growth-brand-assets.ts`: brand asset extraction.
- `growth-rescrape.ts`: Brand Memory rescrape.
- `workspace.ts`: content generation/pipeline flow, ideation prerequisites, scheduling helpers.
- `seo-intelligence.ts`: DataForSEO keyword/SEO data storage and gap analysis.
- `calendar.ts`: calendar data/actions.
- `social.ts`: web-side social helpers.
- `admin.ts`: admin controls.

When changing product behavior, check both the UI component and the server action. For example, competitor UX involves both `CompetitorMapManager.tsx` and `growth-competitors.ts`.

## AI Provider Behavior

`apps/web/src/lib/gemini.ts` contains Gemini orchestration and OpenAI fallback behavior.

Important details:

- Gemini model is read through `getGeminiModel()` from env/app settings.
- OpenAI fallback model is read through `getOpenAiFallbackModel()`; default is `gpt-4.1`.
- Gemini 429/503 responses enable a cooldown to avoid repeated quota calls.
- Several flows use heuristic fallbacks when both providers are unavailable or return invalid JSON.
- Many AI outputs are normalized after JSON parsing; do not trust raw model output directly.

## Database Model Summary

Prisma source of truth: `apps/api/prisma/schema.prisma`.

Core models:

- `User`: app user, Clerk linkage, role/plan.
- `Workspace`: central workspace record. Holds `brandSummary`, `audienceInsights`, competitors, content items/jobs, strategy runs, social connections.
- `Competitor`: name/domain/description/category/audienceGuess/source/type/userDecision.
- `CompetitorKeyword`: stored keyword rows per competitor domain.
- `KeywordOpportunity`: SEO/content opportunity rows.
- `SerpAnalysis`: stored SERP analysis.
- `StrategyRun`: generated strategy docs.
- `ContentItem`: pipeline and scheduled content.
- `ContentJob`: async/generation job metadata.
- `CreditLedger`: append-only credit accounting.
- `SocialConnection`, `SocialPublishJob`, `SocialPublishLog`: social publishing.
- `AiUsageLog`: AI cost audit.
- `activity_logs`, `competitor_discovery_runs`, `app_settings`, admin control tables, and framework metadata tables exist for admin/reporting.

Important enums include `WorkspaceStatus`, `ContentChannel`, `ContentStatus`, `JobStatus`, `JobType`, `SocialPlatform`, and `SocialPublishStatus`.

## Growth Engine Flow

Typical flow:

1. User creates a workspace from `/growth/new`.
2. `createNewWorkspace` in `growth.ts` scrapes the website, runs AI extraction, saves `brandSummary`, creates a progress baseline, and optionally seeds competitors.
3. Workspace dashboard loads `brandSummary`, `audienceInsights`, competitors, content items, discovery archives, app settings, activity logs, and SEO data.
4. User reviews Brand Memory and competitors.
5. User generates competitive matrices.
6. User generates competitor keyword intelligence.
7. Ideation requires both Market Matrices and Competitor Keywords data.
8. Ideas can be moved to pipeline, generated as final drafts, scheduled, and published.

Ideation guardrails:

- `generateIdeas` in `workspace.ts` requires `audienceInsights.competitiveMatrices.charts`.
- It also requires `audienceInsights.competitorKeywordsIntel.competitors`.
- If either is missing, ideation returns a user-facing error.

## Competitive Intelligence Details

Competitor management:

- UI component: `CompetitorMapManager.tsx`.
- Server action: `growth-competitors.ts`.
- Competitor types: `DIRECT`, `INDIRECT`, `ASPIRATIONAL`.
- User decisions: `ACCEPTED`, `REJECTED`, `PENDING`.
- Synthetic placeholder competitors such as `nova labs`, `pulse works`, `axis growth`, `summit metrics`, `clarity forge`, and domains like `market1.com` are filtered out.

Discovery:

- AI discovery has an archive and run limit through `competitor_discovery_runs`.
- Limit is controlled by `getCompetitiveLandscapeLimit()` and env/app setting `COMPETITIVE_LANDSCAPE_LIMIT`.
- Discovery validates DNS/reachability and avoids likely fake companies.
- Discovery prompt explicitly tries to match target-company scale; avoid recommending giant enterprise competitors for a small/solo/boutique business.

Manual competitor enrichment:

- Saving manual competitor edits can enrich competitors with AI when a domain exists and fields are missing/placeholder.
- The action fetches public website evidence from paths like `/`, `/about`, `/services`, `/solutions`, `/products`, `/pricing`, `/blog`.
- Fetch tries both `https://domain/path` and `http://domain/path` because some competitor domains redirect only from HTTP.
- The placeholder text `Manually added competitor` is not treated as a real description.
- OpenAI is used for manual competitor enrichment when `OPENAI_API_KEY` exists.
- After save, accepted competitors can trigger matrix regeneration through `generateWorkspaceCompetitiveMatrices`.
- Matrix refresh needs at least two reviewed/accepted competitors.

Competitor map:

- The upper competitor map in `CompetitorMapManager` is heuristic. It estimates audience size and sophistication from competitor text and type.
- The lower Positioning Matrices are AI-generated and stored in `audienceInsights.competitiveMatrices`.

## Competitive Matrices

Server action: `growth-matrices.ts`.

Chart definitions:

- `price_value_depth`: Price vs Value Depth
- `audience_size_specialization`: Audience Size vs Specialization
- `content_volume_quality`: Content Volume vs Content Quality
- `strategy_execution`: Strategy vs Execution
- `creativity_structure`: Creativity vs Structure

Matrix payload is stored under:

```text
workspace.audienceInsights.competitiveMatrices
```

Matrix generation:

- Pulls accepted competitors first; falls back to non-rejected competitors.
- Includes the target company in every chart with type `TARGET`.
- Scores axis values 1-10.
- Stores token usage totals and last run.
- Falls back to heuristic matrices if OpenAI returns invalid/no output.

Recent UI expectation:

- `CompetitiveMatricesTab` should not force chart, insights, and company list into one row.
- Chart should have its own full-width row.
- `Market Pattern` and `Actionable Gap` should appear below the chart in their own grid.
- `Plotted Companies` should appear below insights and can wrap into multiple columns.
- Persistent labels over every chart dot cause clutter; use numbered markers + tooltip + company list instead.

## Products, Keywords, SEO

Competitor keywords:

- Action: `growth-keywords.ts`.
- Collects public website signals and asks AI for keywords, clusters, content strategy, intent distribution, gaps, and heatmap data.
- Stores payload under `audienceInsights.competitorKeywordsIntel`.

Products/services:

- Action: `growth-offerings.ts`.
- Extracts client and competitor offerings from visible website signals.
- Stores payload under `audienceInsights.productsServicesIntel`.

SEO Intelligence:

- Action: `seo-intelligence.ts`.
- Stores raw competitor keyword rows in `CompetitorKeyword`.
- Stores opportunities in `KeywordOpportunity`.
- Stores SERP analysis in `SerpAnalysis`.
- UI tab: `SeoIntelligenceTab.tsx`.

## Content Pipeline And Publishing

Core action: `workspace.ts`.

Important behavior:

- Ideas are generated with selected/auto frameworks.
- Framework metadata is logged through framework metadata utilities.
- Pipeline draft content stores angle, pillar, target word count, and framework context.
- Manual generation can use user notes, extracted file text, file metadata, target word count, publish date/time/timezone.
- Auto scheduling defaults to a configurable delay, default 4 hours.
- Scheduled/published content redirects to calendar.

Social publishing:

- API modules under `apps/api/src/modules/social`.
- OAuth and publishing adapters exist for LinkedIn, X, Facebook, Instagram, TikTok.
- `SocialPublishJob` should be processed by background workers/cron, not by long synchronous frontend requests.
- Tokens should not be returned to frontend or logged.

## Nest API Boundaries

Nest app entry:

- `apps/api/src/main.ts`
- `apps/api/src/app.module.ts`

API modules:

- `AuthModule`
- `UsersModule`
- `WorkspacesModule`
- `InstantContentModule`
- `AIModule`
- `JobsModule`
- `BillingModule`
- `CreditsModule`
- `HealthModule`
- `SocialModule`

`ConfigModule.forRoot` uses `envFilePath: ['.env.local', '.env']`.

`PrismaService` connects during module init. If DB is down, API startup fails before listening.

BullMQ:

- Redis connection is defined in `apps/api/src/modules/jobs/bull-board.provider.ts`.
- Queue constants and services live in `apps/api/src/modules/jobs`.
- Redis URL defaults to `redis://localhost:6379`.

## Admin And Settings

Admin UI is under `apps/web/src/app/(admin)/admin`.

App settings table:

- `app_settings`
- Managed through `apps/web/src/lib/app-settings.ts`.
- Cached for 30 seconds.

Settings include:

- Gemini model.
- OpenAI fallback model.
- Gemini cooldown seconds.
- Competitive landscape limit.
- Brand Memory rescrape limit.
- Ideation max content count.
- Default schedule delay hours.
- Content word-count limits.

Admin state/control helpers exist for user and workspace archival/suspension controls.

## Current Known Issues And Warnings

Do not ignore these when asking AI for help:

- The git worktree is dirty. Many files already have changes, including user/previous-agent work. Do not revert broad changes unless explicitly requested.
- Typecheck currently fails on typed route errors for `/sign-in` and `/sign-in?redirectUrl=/admin`. This is a known issue after moving Next config to `typedRoutes: true`.
- `apps/web/tsconfig.tsbuildinfo` is modified/generated and should not be treated as meaningful source logic.
- If the UI still shows old server-action messages after code edits, restart the Next dev server and possibly delete `apps/web/.next`.
- API startup fails if PostgreSQL is not available at `localhost:5432`.
- Local Homebrew PostgreSQL may be broken on this machine; Docker Compose is the preferred local path.
- Never paste or commit real secrets from `.env.local`.

## Recent Local Changes To Preserve

These changes are intentional and should not be reverted without discussion:

- `apps/web/next.config.ts`: moved `typedRoutes` out of `experimental`.
- `docker-compose.yml`: includes Redis in addition to PostgreSQL.
- `README.md`: updated local services wording.
- `apps/web/.env.local`: a stray non-env text line was removed earlier.
- `growth-competitors.ts`: manual competitor save can enrich missing fields from website evidence and refresh matrices.
- `CompetitorMapManager.tsx`: save flow can receive refreshed matrices and displays enriched metadata chips.
- `CompetitiveMatricesTab.tsx`: matrix UI was redesigned to reduce chart clutter; chart, insights, and company list should wrap into separate rows.

## Development Rules For Future AI Work

When using AI on this repo:

- First inspect the relevant files. Do not assume architecture from generic Next/Nest patterns.
- Preserve existing functionality unless the task explicitly asks to remove it.
- For Growth Engine features, check both frontend component and server action.
- Do not put long-running publish work inside direct HTTP/UI requests.
- Keep secrets out of generated files and responses.
- Prefer existing helpers such as `writeActivityLog`, `app-settings`, normalization helpers, Prisma models, and AI fallback wrappers.
- If adding new AI output, normalize and validate it before writing to DB.
- If a UI is crowded, restructure layout into separate rows/sections instead of deleting data.
- If changing env or startup behavior, update `.env.example`, `README.md`, and this `memory.md`.

