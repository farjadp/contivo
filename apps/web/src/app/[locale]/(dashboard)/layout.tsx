import { redirect } from '@/i18n/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { getSession } from '@/lib/auth';
import { loadGuidedMode } from '@/lib/first-post/mode';
import { touchLastSeen } from '@/lib/last-seen';
import { getLocale } from 'next-intl/server';

/**
 * Guards every signed-in route in one place.
 *
 * Individual pages used to guard themselves, which left `/growth/new`,
 * `/growth/analyzing` and `/instant` publicly reachable: they are client
 * components with no server-side session check, so a signed-out visitor got
 * a 200 and could fill in the whole workspace form before the server action
 * rejected them with "Not authenticated". Guarding at the layout means a new
 * page under this group cannot forget.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  // lastSeenAt + SESSION_STARTED. Never throws; skips the database for 5 min per user.
  await touchLastSeen(session.userId);

  // Guided mode (spec first-post B §9) drops the Instant Content nav item;
  // /instant stays reachable by URL. A nav item is not worth an error page,
  // so a failed read keeps it.
  const guided = await loadGuidedMode(session.userId).catch((error) => {
    console.error('DashboardLayout: guided mode failed to load:', error);
    return false;
  });

  return <AppShell hideInstant={guided}>{children}</AppShell>;
}
