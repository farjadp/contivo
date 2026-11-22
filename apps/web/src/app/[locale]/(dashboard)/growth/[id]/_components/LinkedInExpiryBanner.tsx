/**
 * LinkedInExpiryBanner.tsx
 *
 * Warns on the workspace page when the default LinkedIn connection's 60-day
 * sign-in has run out or will within a week, before the first post fails.
 * Self-contained server component: reads its own data, renders nothing when
 * all is well. Read-only; the API's 401 path owns status changes.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getDefaultLinkedInExpiry } from '@/lib/social-data';

/** LinkedIn's sign-in lifetime with w_member_social (linkedin.adapter.ts). */
const LINKEDIN_SIGN_IN_DAYS = 60;

const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

export async function LinkedInExpiryBanner({ workspaceId }: { workspaceId: string }) {
  let expiry: Awaited<ReturnType<typeof getDefaultLinkedInExpiry>>;
  try {
    expiry = await getDefaultLinkedInExpiry(workspaceId);
  } catch (err) {
    // A warning must never take the workspace page down; log it, show nothing.
    console.error('[linkedin-expiry-banner] lookup failed', workspaceId, err);
    return null;
  }
  if (!expiry) return null;

  const t = await getTranslations('connectionHealth');
  const expired = expiry.kind === 'expired';
  const values = {
    account: expiry.accountName,
    period: LINKEDIN_SIGN_IN_DAYS,
    days: expiry.kind === 'expiringSoon' ? expiry.daysLeft : 0,
    bdi,
  };

  return (
    <div
      role={expired ? 'alert' : 'status'}
      className={`flex flex-col gap-3 border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        expired ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className={`mt-0.5 h-4 w-4 shrink-0 ${expired ? 'text-red-700' : 'text-amber-700'}`}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-moss">
            {t.rich(expired ? 'expiredTitle' : 'expiringTitle', values)}
          </p>
          <p className="mt-1 text-[13px] text-moss">{t.rich(expired ? 'expiredBody' : 'expiringBody', values)}</p>
        </div>
      </div>
      <Link
        href={{ pathname: '/connections', query: { tab: 'social', workspaceId } }}
        className="inline-flex shrink-0 items-center gap-1.5 self-start bg-moss px-4 py-2 text-sm font-semibold text-chalk hover:bg-moss-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 sm:self-auto"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        {t('cta')}
      </Link>
    </div>
  );
}
