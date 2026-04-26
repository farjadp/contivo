# Changelog

All notable changes to this project are documented here.

## 2026-04-26

### Added

- **Strategic Reports** — new Reports tab on every workspace dashboard; users can generate a full AI-designed market intelligence report (PDF + HTML) up to 5 times per calendar month
- `StrategicReport` Prisma model — stores file paths, metadata snapshot (competitors count, charts count, keywords analyzed), and sections included
- `StrategicReportEligibilityService` (NestJS) — checks monthly limit and data completeness before allowing generation
- `ai-report-designer.ts` — calls Gemini API (OpenAI fallback) with a structured prompt to produce fully-styled HTML; normalises DB field names before sending data so the AI never receives `undefined` values
- `html-to-pdf.ts` — converts AI-generated HTML to a print-ready PDF using Puppeteer (headless Chromium); injects Tailwind CDN and print CSS automatically
- `strategic-report-builder.ts` — pure function that assembles workspace data into a markdown content tree (used as input context for the AI designer)
- `ReportsTab` UI component — eligibility card with missing-data warnings, Generate button, and report history table with PDF + HTML download links
- `ReportGeneratingModal` UI component — full-screen progress overlay with a 4-stage animated progress bar (Preparing data → AI designing → Rendering PDF → Saving); simulates realistic timing since server actions cannot stream progress
- Server actions: `checkReportEligibility`, `generateStrategicReport`, `getReportHistory` in `apps/web/src/app/actions/strategic-reports.ts`
- Puppeteer added to `apps/web` dependencies

### Changed

- Reports tab added to workspace dashboard navigation (alongside Pipeline, Ideation, Brand Memory, Calendar, etc.)
- `WorkspacesModule` now provides and exports `StrategicReportEligibilityService`

### Fixed

- Eligibility check was using camelCase field names (`clientOfferings`, `primaryKeywords`) that don't exist in the DB — corrected to snake_case (`client_offerings.offerings`, `primary_keywords`)
- Matrix data was sending `chart.name`/`chart.xAxis`/`c.x` — corrected to `chart.chart_name`/`chart.axes.x`/`c.x_score`, eliminating "undefined" values in generated reports
- Auth in server actions switched from Clerk's `auth()` to the project's own `getSession()` — resolves Unauthorized errors when actions are called from client components

## 2026-03-13

### Added

- **Social OAuth Integration** — users can now connect their own LinkedIn, X (Twitter), Facebook, and TikTok accounts directly from the Connections page; each workspace stores its own encrypted OAuth tokens
- **LinkedIn OAuth** — full OpenID Connect flow (openid, profile, email, w_member_social); token expiry stored
- **X (Twitter) OAuth** — OAuth 2.0 PKCE flow (tweet.read, tweet.write, users.read, offline.access)
- **Facebook OAuth** — Graph API v19 flow with automatic Page token extraction (pages_manage_posts, pages_read_engagement)
- **TikTok OAuth** — TikTok Open Platform v2 flow (user.info.basic, video.publish, video.upload)
- **Social Adapters** — platform-specific publish adapters for LinkedIn UGC Posts API, X v2 tweets, Facebook Graph API, and TikTok Content Posting API
- **Social Scheduler** — cron-based scheduler (`@Cron(EVERY_MINUTE)`) that auto-publishes content items when their scheduled time is reached
- **CSRF Protection** — HMAC-SHA256 signed state parameter in all OAuth flows to prevent cross-site request forgery
- **Connections Page** — new `/connections` dashboard page with Connected Accounts, Publish Rules, Publish Queue, and Publish History tabs
- `SocialConnection`, `SocialPublishJob`, `SocialPublishLog` Prisma models with encrypted token storage
- `TIKTOK` added to `SocialPlatform` enum across Prisma, types package, and all DTOs
- `tokenExpiresAt` field on `SocialConnection` for proactive token refresh scheduling
- `@nestjs/schedule` integrated for cron job support

### Changed

- Onboarding post-analysis redirect now goes to **Brand Memory** tab instead of Competitors tab
- OAuth redirect URL in `ConnectModal` is now a real backend link (previously placeholder)

### Security

- Social platform access/refresh tokens encrypted server-side (XOR + base64, plan to upgrade to KMS)
- Tokens never logged, never returned to frontend
- OAuth state parameter signed with HMAC-SHA256 and validated on callback (10-minute expiry window)

## 2026-03-12

### Added

- Word-count control for content generation per platform
- Admin-manageable min/max word limits per platform
- Manual source inputs for generation (notes + file extraction)
- Quick publish schedule section (date/time/timezone) directly in pipeline cards

### Changed

- Generation prompt now receives target word count + allowed range
- Pipeline generation now supports custom publish date/time override
- Default publish flow remains auto-schedule from generation time (+4 hours)
- Publish/Schedule actions now redirect to workspace calendar after save

### Fixed

- Invalid Prisma `ContentChannel` value mapping in pipeline save flow
- Gemini 429/503 handling improved with cooldown to reduce repeated quota calls
- More reliable fallback behavior to OpenAI when Gemini is unavailable
