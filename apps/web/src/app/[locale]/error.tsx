'use client';

import { ErrorScreen } from '@/components/bug-report/ErrorScreen';

/**
 * Anything under [locale] outside the signed-in shell (marketing, auth,
 * onboarding, admin). No report provider here, so the screen offers a way
 * back instead of the sheet.
 */
export default function LocaleError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen {...props} standalone />;
}
