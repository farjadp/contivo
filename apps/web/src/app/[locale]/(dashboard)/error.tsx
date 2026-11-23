'use client';

import { ErrorScreen } from '@/components/bug-report/ErrorScreen';

/** A page under the signed-in shell threw: the shell stays, so "Report this" opens the sheet. */
export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen {...props} />;
}
