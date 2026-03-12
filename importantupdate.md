# Important Update

## Date

2026-03-12

## Summary

The content generation and publishing flow has been upgraded for better control and reliability.

## Highlights

- Added word-count controls for each content platform
- Added admin controls to manage min/max word limits
- Added quick inline publish scheduling on pipeline cards
- Preserved auto-scheduling default: first publish is 4 hours after generation
- Added redirect-to-calendar behavior after publish/schedule actions
- Fixed invalid content channel mapping when saving ideas to pipeline
- Improved Gemini quota handling with cooldown + fallback behavior

## Action Required

- Verify `.env` contains valid `OPENAI_API_KEY` for fallback reliability
- Review admin platform limits in `/admin` or `/settings`
- Re-test pipeline publish flow end-to-end
