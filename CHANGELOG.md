# Changelog

All notable changes to this project are documented here.

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
