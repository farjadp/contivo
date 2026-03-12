# Changelog

All notable changes to this project are documented here.

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
